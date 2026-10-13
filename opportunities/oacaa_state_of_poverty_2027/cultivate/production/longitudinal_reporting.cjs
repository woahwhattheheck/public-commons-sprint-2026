"use strict";
/* Original Ohio poverty-ratio and historical-source normalizer.
   Run: node longitudinal_reporting.cjs [production-directory].
   Uses retained source files only; no network or credentials. */
const COLUMNS=["Total:","Under .50",".50 to .99","1.00 to 1.24","1.25 to 1.49","1.50 to 1.84","1.85 to 1.99","2.00 and over"];
const UNIVERSE="Population for whom poverty status is determined";
const YEARS=[2018,2019,2021,2022,2023,2024];
function assert(ok,message){if(!ok)throw Error(message);}
function decimal(n,d,places=1){
 assert(Number.isSafeInteger(n)&&Number.isSafeInteger(d)&&d>0,"Invalid exact ratio");
 let a=BigInt(Math.abs(n))*10n**BigInt(places),b=BigInt(d),v=(a*2n+b)/(b*2n);
 const sign=n<0&&v!==0n?"-":"";let t=v.toString().padStart(places+1,"0");
 return sign+(places?t.slice(0,-places)+"."+t.slice(-places):t);
}
function integer(value,label){
 assert(typeof value==="number"&&Number.isSafeInteger(value)&&value>=0,"Missing/invalid source value: "+label);return value;
}
function c17002(estimate,error,label){
 assert(estimate.length===8&&error.length===8,"Incomplete C17002: "+label);
 estimate.forEach((v,i)=>integer(v,label+" estimate "+i));error.forEach((v,i)=>integer(v,label+" MOE "+i));
 assert(estimate.slice(1).reduce((a,b)=>a+b,0)===estimate[0],"Source population partition fails: "+label);
 return {estimate,error,below100:estimate[1]+estimate[2],below200:estimate.slice(1,7).reduce((a,b)=>a+b,0)};
}
function publicColumn(text,{year,geo,period}){
 const g=geo==="Ohio"?"040XX00US39":"010XX00US";
 assert(text.includes("/ACSDT"+(period==="five-year"?"5Y":"1Y")+year+".C17002?g="+g),"Source table/year/geography mismatch");
 assert(text.includes("U.S. Census Bureau, "+(period==="five-year"?"2006-2010":year)+" American Community Survey"),"Missing original release footnote");
 const marker="2.00 and over",start=text.indexOf(marker);assert(start>=0,"Source categories absent");
 const body=text.slice(start+marker.length).split("* * *")[0];
 const cells=body.split(/\r?\n/).map(x=>x.trim()).filter(x=>/^(?:±)?[\d,]+$/.test(x));
 assert(cells.length===16,"Expected eight estimate/MOE pairs, received "+cells.length);
 const e=[],m=[];for(let i=0;i<cells.length;i+=2){
  assert(!cells[i].startsWith("±")&&cells[i+1].startsWith("±"),"Source estimate/MOE order differs");
  e.push(Number(cells[i].replace(/,/g,"")));m.push(Number(cells[i+1].slice(1).replace(/,/g,"")));
 }
 return c17002(e,m,geo+" "+year);
}
function sf3State(text){
 assert(text.includes("RATIO OF INCOME IN 1999 TO POVERTY LEVEL")&&text.includes("2000: DEC Summary File 3")&&text.includes("\nOhio\n"),"Original 2000 SF3 source identity missing");
 const marker="2.00 and over",start=text.lastIndexOf(marker);assert(start>=0,"SF3 source categories missing");
 const cells=text.slice(start+marker.length).split("\nColumns")[0].split(/\r?\n/).map(x=>x.trim()).filter(x=>/^[\d,]+$/.test(x)).map(x=>Number(x.replace(/,/g,"")));
 assert(cells.length===10,"Expected ten original SF3 estimates");
 cells.forEach((v,i)=>integer(v,"SF3 "+i));
 assert(cells.slice(1).reduce((a,b)=>a+b,0)===cells[0],"SF3 population does not reconcile");
 return {estimate:[cells[0],cells[1],cells[2]+cells[3],cells[4],cells[5],cells[6]+cells[7],cells[8],cells[9]],error:Array(8).fill(null),original:cells,below100:cells[1]+cells[2]+cells[3],below200:cells.slice(1,9).reduce((a,b)=>a+b,0)};
}
function col(key,label,kind,role,unit,definition){
 return {key,label,kind,role,unit:unit||"",period:"",definition};
}
function dataset(id,title,period,geography,description,columns,rows,source){
 return {schema:"tjl.publication.report-dataset.v1",id,title,description,publicationPeriod:"2026 working production",dataPeriod:period,geography,
 methodology:"Exact retained Census source counts. Ratios are derived from unrounded counts and rounded to one decimal. Component margins of error remain published values. Derived sums/rates have blank MOEs; no significance or causal claim is inferred.",
 source,columns,rows};
}
function summaryValues(s){
 return {population:String(s.estimate[0]),population_moe:s.error[0]===null?"":String(s.error[0]),below100:String(s.below100),below100_rate:decimal(s.below100*100,s.estimate[0]),below100_moe:"",
 below200:String(s.below200),below200_rate:decimal(s.below200*100,s.estimate[0]),below200_moe:""};
}
function summaryColumns(){
 return [col("population","Population in poverty universe","integer","denominator","people",UNIVERSE),
 col("population_moe","Population MOE","integer","margin-of-error","people","Published 90% ACS margin of error; blank when not provided by this original source."),
 col("below100","Income below poverty threshold","integer","value","people","Sum of disjoint source bins below income-to-poverty ratio 1.00."),
 col("below100_rate","Below poverty (%)","decimal","value","percent","100 times below100 divided by population, rounded to one decimal."),
 col("below100_moe","Below-poverty derived MOE","decimal","margin-of-error","people","Blank: no derived sum MOE is represented as an original published value."),
 col("below200","Income below twice poverty threshold","integer","value","people","Sum of disjoint bins below ratio 2.00. Includes people below the poverty threshold."),
 col("below200_rate","Below twice poverty (%)","decimal","value","percent","100 times below200 divided by population, rounded to one decimal."),
 col("below200_moe","Below-twice-poverty derived MOE","decimal","margin-of-error","people","Blank: component uncertainty is retained in the original source.")];
}

function annualSeries(input){
 assert(Array.isArray(input.annual)&&input.annual.length===12,"Twelve complete annual geography tables are required");
 const expected=new Set(YEARS.flatMap(y=>["Ohio","US"].map(g=>y+":"+g))),rows=[];
 for(const rec of input.annual){
  const key=rec.year+":"+rec.geo;assert(expected.delete(key),"Duplicate or unexpected annual source "+key);
  let s;if(rec.format==="census-reporter"){
  const raw=JSON.parse(rec.text);assert(raw.release.id==="acs"+rec.year+"_1yr"&&raw.release.years===String(rec.year),"Annual JSON release differs");
  assert(raw.tables.C17002.universe===UNIVERSE,"Annual JSON universe differs");
  const k=Array.from({length:8},(_,i)=>"C17002"+String(i+1).padStart(3,"0"));
  k.forEach((x,i)=>assert(raw.tables.C17002.columns[x].name===COLUMNS[i],"Annual JSON categories differ"));
  const d=raw.data[rec.geo==="US"?"01000US":"04000US39"].C17002;s=c17002(k.map(x=>d.estimate[x]),k.map(x=>d.error[x]),key);
 }else{s=publicColumn(rec.text,{year:rec.year,geo:rec.geo,period:"one-year"});}
 const values={label:String(rec.year),year:String(rec.year),geography:rec.geo==="US"?"United States":"Ohio",geoid:rec.geo==="US"?"01000US":"04000US39",...summaryValues(s)};
  for(let i=1;i<8;i++){values["bin"+i]=String(s.estimate[i]);values["bin"+i+"_moe"]=String(s.error[i]);}
  values.source_url=rec.url;values.note="Standard ACS one-year estimate. Ohio overlaps the United States; these populations must not be added. Derived sum/rate MOEs are blank.";
  rows.push({id:rec.geo.toLowerCase()+"-"+rec.year,values,locator:rec.geo+" / "+rec.year+" ACS one-year C17002 / original eight estimate–MOE pairs",note:"Source universe: "+UNIVERSE+"."});
 }
 assert(expected.size===0,"Annual source cohort is incomplete");
 const columns=[col("label","Year","text","label","","Measurement year"),col("year","Year","integer","period","year","Standard ACS one-year release"),col("geography","Geography","text","geography","","Original geography"),col("geoid","Census geography ID","text","geography","","Original Census geography ID"),...summaryColumns()];
 for(let i=1;i<8;i++)columns.push(col("bin"+i,COLUMNS[i],"integer","value","people","Original C17002 component estimate"),col("bin"+i+"_moe",COLUMNS[i]+" MOE","integer","margin-of-error","people","Original 90% component margin of error"));
 columns.push(col("source_url","Original source","text","source","","Exact public table URL"),col("note","Interpretation","text","note","","Period, population and uncertainty"));
 for(const geo of ["Ohio","US"]){
  const values=Object.fromEntries(columns.map(c=>[c.key,""]));Object.assign(values,{label:"2020 — standard series unavailable",year:"2020",geography:geo==="US"?"United States":"Ohio",geoid:geo==="US"?"01000US":"04000US39",source_url:"https://www.census.gov/programs-surveys/acs/guidance/comparing-acs-data/2020.html",note:"The Census Bureau did not release standard 2020 ACS one-year estimates. Experimental estimates are excluded from this standard-series comparison. Empty cells are missing, not zero."});
  rows.push({id:geo.toLowerCase()+"-2020",values,locator:"Census Bureau / Comparing 2020 ACS Data / experimental one-year guidance",note:"Intentional source gap; preserve it in publication."});
 }
 rows.sort((a,b)=>a.values.geoid.localeCompare(b.values.geoid)||Number(a.values.year)-Number(b.values.year));
 const source={title:"U.S. Census Bureau ACS one-year C17002, 2018–2019 and 2021–2024",url:"https://data.census.gov/table/ACSDT1Y2024.C17002?g=040XX00US39",locator:"Twelve original geography/year tables; each source URL is retained with its row",publisher:"U.S. Census Bureau",retrievedAt:"2026-10-13",note:"The standard 2020 series was not released; two explicit empty rows preserve that gap.",rights:"U.S. Census statistical data"};
 return dataset("ohio-us-annual-poverty-ratios-2018-2024","Ohio and United States annual poverty ratios","2018–2019; 2021–2024; explicit 2020 standard-series gap","Ohio and United States","Standard ACS one-year series with all seven disjoint income-ratio categories and original margins of error. National and Ohio populations overlap.",columns,rows,source);
}

function transform(input){
 const raw=JSON.parse(input.current),release=raw.release;
 assert(release.id==="acs2024_5yr"&&release.years==="2020-2024","Wrong current release");
 const table=raw.tables.C17002;
 assert(table.universe===UNIVERSE,"Wrong C17002 universe");
 for(let i=0;i<8;i++)assert(table.columns["C17002"+String(i+1).padStart(3,"0")].name===COLUMNS[i],"Source category definition changed");
 const geoids=["04000US39",...Array.from({length:88},(_,i)=>"05000US39"+String(2*i+1).padStart(3,"0"))];
 assert(Object.keys(raw.data).length===89&&geoids.every(g=>raw.data[g]),"The Ohio/88-county cohort is incomplete");
 const summaries={},rows=[];
 for(const g of geoids){
  const d=raw.data[g].C17002,k=Array.from({length:8},(_,i)=>"C17002"+String(i+1).padStart(3,"0"));
  const s=c17002(k.map(x=>d.estimate[x]),k.map(x=>d.error[x]),g);summaries[g]=s;
  const values={label:raw.geography[g].name,geoid:g,county_fips:g.startsWith("050")?g.slice(-3):"",period:"2020–2024",...summaryValues(s)};
  for(let i=1;i<8;i++){values["bin"+i]=String(s.estimate[i]);values["bin"+i+"_moe"]=String(s.error[i]);}
  values.source_variables=k.join("; ");values.note="Cumulative below100/below200 totals overlap. Seven income-ratio bins are disjoint. Derived uncertainty is left blank.";
  rows.push({id:g,values,locator:g+" / C17002 estimate and error / cells001–008",note:"Exact component count/MOE pairs retained; percentage denominator is the poverty universe."});
 }
 const columns=[col("label","Geography","text","label","","Original Census geography"),col("geoid","Census geography ID","text","geography","","Original full geography code"),col("county_fips","County FIPS","text","geography","","Three-digit Ohio county FIPS; blank for state"),col("period","Measurement period","text","period","","2020–2024 five-year estimates"),...summaryColumns()];
 for(let i=1;i<8;i++){columns.push(col("bin"+i,COLUMNS[i],"integer","value","people","Original C17002 cell "+String(i+1).padStart(3,"0")+" estimate"),col("bin"+i+"_moe",COLUMNS[i]+" MOE","integer","margin-of-error","people","Original 90% component margin of error"));}
 columns.push(col("source_variables","Source variables","text","source","","All original variables"),col("note","Calculation note","text","note","","Scope and uncertainty"));
 const county=dataset("ohio-acs5-poverty-ratios-2024","Ohio county poverty and near-poverty ratios","2020–2024","Ohio and all 88 counties","Complete consistent five-year county directory. State and counties overlap; do not add the Ohio row to its counties.",columns,rows,input.sources.current);
 const historical=[{id:"ohio-1999-sf3",label:"1999 income · 2000 Census",period:"1999",survey:"2000 Census SF3",s:sf3State(input.sf3),source:input.sources.sf3,warning:"Cross-survey historical reference. This is the original report transcription's baseline count, not a 2010 measure."},
 {id:"ohio-2006-2010",label:"2006–2010 ACS five-year",period:"2006–2010",survey:"ACS five-year",s:publicColumn(input.acs2010,{year:2010,geo:"Ohio",period:"five-year"}),source:input.sources.acs2010,warning:"Nonoverlapping ACS period for comparison with 2020–2024."},
 {id:"ohio-2020-2024",label:"2020–2024 ACS five-year",period:"2020–2024",survey:"ACS five-year",s:summaries["04000US39"],source:input.sources.current,warning:"Same current Census source as county directory; not an additional population."}];
 const histColumns=[col("label","Source period","text","label","","Exact source/release period"),col("period","Measurement period","text","period","","Income year or five-year collection period"),col("survey","Survey","text","note","","Original survey product"),...summaryColumns(),col("source_url","Original source","text","source","","Authoritative public table"),col("note","Interpretation","text","note","","Comparison limits")];
 const history=dataset("ohio-poverty-ratio-history","Ohio poverty-ratio history with corrected source periods","1999;2006–2010;2020–2024","Ohio","The 1999 SF3 benchmark is retained as a historical reference; the two nonoverlapping ACS five-year periods form the like-product comparison.",histColumns,historical.map(h=>({id:h.id,values:{label:h.label,period:h.period,survey:h.survey,...summaryValues(h.s),source_url:h.source.url,note:h.warning},locator:h.source.locator,note:"Derived rates use unrounded source counts."})),input.sources.acs2010);
 const a=historical[1].s,b=historical[2].s;
 const changes={periods:["2006–2010","2020–2024"],population:b.estimate[0]-a.estimate[0],below200:b.below200-a.below200,
 percentagePoints:decimal(100*(b.below200*a.estimate[0]-a.below200*b.estimate[0]),b.estimate[0]*a.estimate[0]),
 relativeRatePercent:decimal(100*(b.below200*a.estimate[0]-a.below200*b.estimate[0]),a.below200*b.estimate[0]),
 significance:"Not assessed; retained component MOEs do not by themselves supply a published change interval."};
 return {county,history,...(input.annual?{annual:annualSeries(input)}:{}),changes,checks:{geographies:89,publishedCells:89*16,state1999Partition:true,state2010Partition:true,countyPartitions:89}};
}

function concordance(input,out){
 const original=JSON.parse(input.ocr),tables=original.excerpts;
 assert(tables.length===2&&tables[1].text.includes("Table 11."),"Original report excerpt differs");
 const rows=[...tables[1].text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x=>x[1].trim()));
 const names=Object.fromEntries(out.county.rows.map(r=>[r.values.label.replace(/ County, OH$/,""),r]));
 const checks=[];
 for(const cells of rows){
  let name=cells[0];if(name==="uyahoga C")name="Cuyahoga";if(name==="--Medina -")name="Medina";
  const row=names[name];if(!row)continue;
  const fields=[["population",cells[4]],["below200",cells[5]],["below200_rate",cells[6]]].map(([key,value])=>{
   const clean=(value||"").replaceAll(",","").replaceAll("%","").trim(),valid=/^\d+(?:\.\d+)?$/.test(clean);
   return {field:key,original:value,received:row.values[key],status:valid?(Number(clean)===Number(row.values[key])?"matches":"transcription differs; inspect original page"):"OCR alignment review"};
  });
  checks.push({geography:name,geoid:row.id,originalCells:cells,fields});
 }
 const primary=out.annual.rows.find(r=>r.id==="us-2024"),redistributed=JSON.parse(input.redistribution2024).data["01000US"].C17002.estimate;
 const selected={C17002001:Number(primary.values.population),...Object.fromEntries(Array.from({length:7},(_,i)=>["C17002"+String(i+2).padStart(3,"0"),Number(primary.values["bin"+(i+1)])]))};
 const differences=Object.entries(selected).filter(([key,value])=>redistributed[key]!==value).map(([variable,primaryValue])=>({variable,redistributedValue:redistributed[variable],primaryValue,selectedSource:primary.values.source_url}));
 const old=out.annual.rows.find(r=>r.id==="ohio-2019").values,now=out.annual.rows.find(r=>r.id==="ohio-2024").values;
 return {schema:"tjl.oacaa.longitudinal-concordance.v1",sourceRepresentation:"The original report excerpts are unchanged retained OCR text; page images have not been visually checked in this source arm.",
  table11:{originalBaselineLabel:"2010",originalOhio:{population:"11046987",below200:"2919858",rate:"26.4"},resolvedOhioSource:"2000 Census SF3 P088, income in 1999",workingDisposition:"Keep the 1999 benchmark clearly identified; show the actual 2006–2010 and 2020–2024 ACS five-year sources separately.",currentSourcePeriod:"2020–2024",currentRowsChecked:checks.length,currentRowsMatchingEveryCheckedCell:checks.filter(r=>r.fields.every(f=>f.status==="matches")).length,unmatchedGeographies:out.county.rows.filter(r=>!checks.some(c=>c.geoid===r.id)).map(r=>({geoid:r.id,name:r.values.label,reason:"OCR row contains merged footer text; original complete span retained."})),rows:checks},
  table8:{standardYears:YEARS,missingStandardYear:2020,workingDisposition:"Original 2020 transcription retained. Standard-series tables use empty 2020 cells and bars over available years, excluding experimental 2020 estimates.",guidance:"https://www.census.gov/programs-surveys/acs/guidance/comparing-acs-data/2020.html"},
  table9:{years:[2019,2024],populationChange:String(Number(now.population)-Number(old.population)),povertyCountChange:String(Number(now.below100)-Number(old.below100)),povertyCountPercentChange:decimal((Number(now.below100)-Number(old.below100))*100,Number(old.below100)),workingDisposition:"Received annual source counts match the original reported Ohio counts. Changes are descriptive; no significance assertion."},
  national2024:{selectedSource:primary.values.source_url,redistributionSource:"https://api.censusreporter.org/1.0/data/show/acs2024_1yr?table_ids=C17002&geo_ids=04000US39,01000US",differences,workingDisposition:"The original redistribution remains unchanged in the archive. The national row uses exact primary Census table values, whose seven bins sum to its total. Ohio values from the same redistribution remain unchanged."},
  likeProductChange:out.changes};
}

if(typeof module!=="undefined")module.exports={transform,annualSeries,concordance,publicColumn,sf3State,decimal,COLUMNS};
if(typeof require!=="undefined"&&require.main===module){
 const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),root=path.resolve(process.argv[2]||__dirname);
 const lock=JSON.parse(fs.readFileSync(path.join(root,"LONGITUDINAL_SOURCE_MANIFEST.json"),"utf8")),input={sources:lock.sources};
 for(const [key,rec] of Object.entries(lock.inputs)){
  const bytes=fs.readFileSync(path.join(root,rec.path));assert(bytes.length===rec.bytes&&crypto.createHash("sha256").update(bytes).digest("hex")===rec.sha256,"Original source hash differs:"+key);input[key]=bytes.toString("utf8");
 }
 input.annual=(lock.annual||[]).map(rec=>{const bytes=fs.readFileSync(path.join(root,rec.path));assert(bytes.length===rec.bytes&&crypto.createHash("sha256").update(bytes).digest("hex")===rec.sha256,"Annual original source hash differs: "+rec.path);return {...rec,text:bytes.toString("utf8")};});
 const out=transform(input);fs.mkdirSync(path.join(root,"datasets"),{recursive:true});
 for(const key of ["county","history","annual"])fs.writeFileSync(path.join(root,"datasets",out[key].id+".json"),JSON.stringify(out[key],null,2)+"\n");
 fs.writeFileSync(path.join(root,"LONGITUDINAL_CONCORDANCE.json"),JSON.stringify(concordance(input,out),null,2)+"\n");
 console.log(JSON.stringify({checks:out.checks,annualTables:input.annual.length,annualPublishedCells:input.annual.length*16,changes:out.changes},null,2));
}
