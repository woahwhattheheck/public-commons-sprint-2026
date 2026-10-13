"use strict";
function cents(value) {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Expected exact monetary decimal: "+value);
  const sign=value[0]==="-"?-1n:1n, parts=value.replace(/^-/,"").split(".");
  return sign*(BigInt(parts[0])*100n+BigInt((parts[1]||"").padEnd(2,"0")));
}
function decimal(value) {
  const sign=value<0n?"-":"", abs=value<0n?-value:value;
  return sign+String(abs/100n)+"."+String(abs%100n).padStart(2,"0");
}
function column(key,label,kind,role,unit,period,definition="") { return {key,label,kind,role,unit,period,definition}; }
function build(source,benchmarks) {
  if(source.schema!=="tjl.oacaa.household-illustration-source.v1"||benchmarks.schema!=="tjl.oacaa.household-benchmarks-source.v1") throw new Error("Wrong original source schema");
  if(source.counties.length!==3||source.columns.length!==14) throw new Error("Expected all three published counties and fourteen rows");
  const keys=source.columns.map(x=>x[0]), ids=new Set(), benchmarkIds=new Set();
  const benchmark=Object.fromEntries(benchmarks.rows.map(row=>{
    if(benchmarkIds.has(row.id)) throw new Error("Duplicate benchmark");
    benchmarkIds.add(row.id); cents(row.value); return [row.id,row];
  }));
  if(benchmarks.rows.length!==4||!benchmark["ohio-wage-2024"]||!benchmark["census-threshold-2024"]) throw new Error("Missing benchmark originals");
  const period="Published 2025 Table 5; comparison labels retain their printed years";
  const columns=[
    column("county","Published county","text","geography","",period),
    column("published_position","Published selection","text","note","",period,"The source's low/middle/high labels; not independently reproduced statewide ranks."),
    column("household","Household type","text","denominator","",period),
    ...source.columns.map(([key,label,unit])=>column(key,label,unit==="USD per hour"?"decimal":"integer","value",unit,period,key.startsWith("printed_")?"Exact published comparison, including its original year label; see independent benchmark dataset.":"Exact published amount.")),
    column("component_sum","Sum of seven printed monthly components","integer","value","USD per month",period,"Arithmetic sum of housing, child care, food, transport, health care, miscellaneous and taxes."),
    column("component_gap","Component sum minus printed monthly income","integer","value","USD per month",period,"Reconciliation difference, not an inferred tax credit or a proposed replacement budget."),
    column("comparison_wage_2024","Actual 2024 non-tipped Ohio rate","decimal","value","USD per hour","2024","Selected original state poster; coverage and exceptions remain in benchmark source."),
    column("comparison_hourly_gap_2024","2024 state rate minus published required hourly wage","decimal","value","USD per hour","2024 benchmark versus published 2025 illustration","Explicit cross-period comparison; does not revise the published household standard."),
    column("comparison_threshold_2024","Actual 2024 official four-person/two-child threshold","integer","value","USD per year","2024","Original Census statistical threshold, distinct from HHS guidelines."),
    column("comparison_annual_gap_2024","2024 threshold minus published required annual income","integer","value","USD per year","2024 benchmark versus published 2025 illustration","Explicit cross-period comparison; does not revise the published household standard.")
  ];
  const rows=source.counties.map(county=>{
    if(ids.has(county.id)||county.values.length!==keys.length) throw new Error("Incomplete or repeated original county");
    ids.add(county.id); county.values.forEach(cents);
    const values={county:county.county,published_position:county.publishedPosition,household:source.household,...Object.fromEntries(keys.map((key,i)=>[key,county.values[i]]))};
    const sum=keys.slice(0,7).reduce((n,key)=>n+BigInt(values[key]),0n);
    values.component_sum=String(sum);
    values.component_gap=String(sum-BigInt(values.monthly_income));
    values.comparison_wage_2024=benchmark["ohio-wage-2024"].value;
    values.comparison_hourly_gap_2024=decimal(cents(values.comparison_wage_2024)-cents(values.hourly_wage));
    values.comparison_threshold_2024=benchmark["census-threshold-2024"].value;
    values.comparison_annual_gap_2024=String(BigInt(values.comparison_threshold_2024)-BigInt(values.annual_income));
    if(decimal(cents(values.printed_minimum_wage)-cents(values.hourly_wage))!==decimal(cents(values.printed_hourly_difference))) throw new Error("Published hourly arithmetic differs; preserve and resolve explicitly");
    if(BigInt(values.printed_poverty_threshold)-BigInt(values.annual_income)!==BigInt(values.printed_annual_difference)) throw new Error("Published annual arithmetic differs; preserve and resolve explicitly");
    return {id:"household-illustration-"+county.id,values,locator:source.locator+"; "+county.county+" column",note:"All fourteen original numeric cells are retained. Original comparison labels are not silently corrected; separate primary sources identify their periods."};
  });
  const illustration={
    schema:"tjl.publication.report-dataset.v1",id:"ohio-household-published-illustration-2025",title:"Published household-cost illustration: three Ohio counties",
    description:"Complete statistical Table 5 transcription from OACAA's 2025 report, with reproducible component arithmetic and separately dated benchmark comparisons.",
    publicationPeriod:"2026 working production",dataPeriod:period,geography:"Vinton, Sandusky and Delaware counties, Ohio; selected published illustrations",
    methodology:"Preserve all 42 published numeric cells for two adults and two school-age children. Calculate with exact decimal/integer arithmetic. The component gap is an unresolved reconciliation difference; it is not interpreted as a credit. Comparison columns explicitly pair actual 2024 benchmarks with the published 2025 illustration.",
    source:{title:source.title,url:source.url,locator:source.locator,publisher:"Ohio Association of Community Action Agencies",retrievedAt:source.retrievedAt,note:source.capture,rights:"Factual statistical transcription with source attribution; no reproduction of report artwork or prose."},
    columns,rows
  };
  const benchmarkDataset={
    schema:"tjl.publication.report-dataset.v1",id:"household-comparison-benchmarks-2023-2025",title:"Household illustration: benchmark years and definitions",
    description:"Actual original Ohio state wage posters and Census official poverty-threshold cells supporting the published-table year comparison.",
    publicationPeriod:"2026 working production",dataPeriod:"Separate calendar-year benchmarks: 2023, 2024, 2025",geography:"Ohio wage rate; United States official poverty thresholds",
    methodology:"Each benchmark remains a separate observation with its own monetary unit, year and population. Hourly pay rates and annual statistical thresholds are not combined or ranked on one axis.",
    source:{title:"Ohio Department of Commerce posters and U.S. Census Bureau Appendix A tables",url:benchmark["ohio-wage-2025"].url,locator:"Exact original publication/row locators retained in every dataset row and sources/HOUSEHOLD_BENCHMARKS.json",publisher:"Ohio Department of Commerce; U.S. Census Bureau",retrievedAt:benchmarks.retrievedAt,note:"The2024 poster is the original state document hosted by University of Dayton; 2025 poster is on the state asset host.",rights:"Government factual rate/threshold observations; source attribution retained."},
    columns:[
      column("measure","Benchmark","text","label","","Each row year"),
      column("year","Year","text","period","","Each row year"),
      column("amount","Amount","decimal","value","See unit column","Each row year"),
      column("unit","Unit","text","note","","Each row year"),
      column("universe","Population / application","text","denominator","","Each row year"),
      column("source_url","Original publication","text","source","","Each row year")
    ],
    rows:benchmarks.rows.map(row=>({id:row.id,values:{measure:row.measure,year:row.year,amount:row.value,unit:row.unit,universe:row.universe,source_url:row.url},locator:row.locator,note:row.evidence}))
  };
  const concordance={
    schema:"tjl.oacaa.household-illustration-concordance.v1",
    sourceYear:"2025 published Table 5",
    originalCells:42,
    items:[
      {id:"wage-year",originalLabel:"2024 Ohio Minimum Wage (hourly)",originalValue:"10.70",actualBenchmarkId:"ohio-wage-2025",actualYear:"2025",actual2024Value:"10.45",finding:"Published amount matches the 2025 non-tipped state rate, not 2024.",sourceUrls:[benchmark["ohio-wage-2024"].url,benchmark["ohio-wage-2025"].url]},
      {id:"threshold-year",originalLabel:"2024 federal poverty level threshold (annual)",originalValue:"30900",actualBenchmarkId:"census-threshold-2023",actualYear:"2023",actual2024Value:"31812",finding:"Published amount matches the 2023 official four-person/two-child threshold. It is neither the 2024 cell nor a geographically varying county threshold.",sourceUrls:[benchmark["census-threshold-2023"].url,benchmark["census-threshold-2024"].url]},
      {id:"monthly-components",finding:"The seven displayed component rows exceed the printed monthly required income. Retain both values and the difference. Do not infer undisclosed credit components or silently replace a published total.",counties:rows.map(row=>({id:row.id,county:row.values.county,componentSum:row.values.component_sum,printedMonthly:row.values.monthly_income,difference:row.values.component_gap})),sourceUrls:[source.url]},
      {id:"county-selection",finding:"Vinton/Sandusky/Delaware are the actual 2025 table columns and source-note county names. The 2026 retained OCR footer has a different county list. Original 2025 publication establishes an antecedent; actual 2026 pixels and the full selected household workbook control that later reconciliation.",sourceUrls:[source.url,"https://oacaa.org/wp-content/uploads/2026/08/2026-state-of-poverty-report_final-low.pdf"]},
      {id:"comparison-purpose",finding:"The derived 2024 comparison columns are explicit comparisons of an actual 2024 benchmark with a published 2025 illustration. They are not a newly calculated self-sufficiency standard, a 2025 poverty threshold, or a 2026 household estimate."}
    ]
  };
  for(const dataset of [illustration,benchmarkDataset]) {
    const ck=dataset.columns.map(c=>c.key);
    if(ck.length>32) throw new Error("Dataset column limit exceeded");
    for(const row of dataset.rows) if(Object.keys(row.values).length!==ck.length||ck.some(key=>typeof row.values[key]!=="string")) throw new Error("Incomplete string-valued dataset row");
  }
  return {illustration,benchmarks:benchmarkDataset,concordance};
}
function csv(dataset) {
  const quote=v=>'"'+String(v).replace(/"/g,'""')+'"';
  const keys=dataset.columns.map(c=>c.key);
  return [["id",...keys,"locator","note"],...dataset.rows.map(r=>[r.id,...keys.map(k=>r.values[k]),r.locator,r.note])].map(row=>row.map(quote).join(",")).join("\n")+"\n";
}
module.exports={build,csv};
if(require.main===module) {
  const fs=require("fs"),path=require("path"),root=process.argv[2]||__dirname;
  const result=build(JSON.parse(fs.readFileSync(path.join(root,"sources/HOUSEHOLD_TABLE5_2025.json"),"utf8")),JSON.parse(fs.readFileSync(path.join(root,"sources/HOUSEHOLD_BENCHMARKS.json"),"utf8")));
  fs.mkdirSync(path.join(root,"datasets"),{recursive:true});
  for(const dataset of [result.illustration,result.benchmarks]) {
    fs.writeFileSync(path.join(root,"datasets",dataset.id+".json"),JSON.stringify(dataset,null,2)+"\n");
    fs.writeFileSync(path.join(root,"datasets",dataset.id+".csv"),csv(dataset));
  }
  fs.writeFileSync(path.join(root,"HOUSEHOLD_ILLUSTRATION_CONCORDANCE.json"),JSON.stringify(result.concordance,null,2)+"\n");
  process.stdout.write(JSON.stringify({datasets:2,rows:7,originalCells:42})+"\n");
}
