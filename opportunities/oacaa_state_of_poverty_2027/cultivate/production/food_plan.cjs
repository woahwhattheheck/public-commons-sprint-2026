'use strict';
/** Compile the received food cohorts into the existing report-data commissioning plan. */
function buildPlan(datasets,sha256Utf8){
 const sourceIds=['food-mmg-2026','food-mmg-method-2026','food-hcn-history'];
 const sources=[
 {id:sourceIds[0],title:'Feeding America: 2024 Ohio food insecurity, released 2026',
 url:'https://map.feedingamerica.org/county/2024/child/ohio',
 locator:'Statewide child/overall pages and all 88 county child pages; source representations and SHA-256 identities are retained.',
 note:'Each observation carries its exact measurement year, geography and selected population.'},
 {id:sourceIds[1],title:'Map the Meal Gap 2026 technical brief',
 url:'https://www.feedingamerica.org/sites/default/files/2026-09/Map%20the%20Meal%20Gap%20Technical%20Brief.pdf',
 locator:'Physical pages 4–5: correction to 2023 county estimates; methodology sections: food insecurity, income thresholds and costs.',
 note:'State and congressional estimates were unaffected by the documented county correction. Preserve independently rounded values and distinct population universes.'},
 {id:sourceIds[2],title:'Healthy Northeast Ohio: Feeding America historical county redistribution',
 url:'https://embed-cuyahoga.thehcn.net/indicators/index/indicatorcsv?indicatorId=2108&localeFilterId=0&localeTypeId=2',
 locator:'Complete 108-row source CSV: nine counties, 2013–2024.',
 note:'The source names Feeding America and is maintained by Conduent Healthy Communities Institute. Earlier unavailable counts remain blank.'}
 ];
 const paragraph=(id,text,ids=[sourceIds[0],sourceIds[1]])=>({id,type:'paragraph',text,sourceIds:ids});
 const section=(id,title,summary,blocks)=>({id,title,summary,breakBefore:true,blocks});
 const sections=[
 section('food-ohio','Food insecurity in Ohio','2024 measurement year · 2026 release',[
 paragraph('food-populations','The tables show the source estimates of people and children living in food-insecure households in Ohio in 2024. Child observations concern people under age 18. The overall population includes children, so the two rows overlap.'),
 paragraph('food-income-context','The income-threshold percentages concern people already estimated to be food insecure. Ohio child estimates use 185% of the federal poverty level, while the overall page displays the 130% SNAP threshold. These percentages describe income, rather than actual enrollment or every eligibility rule.'),
 paragraph('food-rounding','Source counts and percentages are independently rounded. The overall page publishes 60% above and 41% below its threshold; both remain as published. No exact population denominator is reconstructed from those rounded values.')]),
 section('food-county-counts','Child food insecurity across Ohio counties','Complete 88-county cohort · 2024',[
 paragraph('food-county-universe','Each row represents children under age 18 in the named county. County counts and percentages come from that county’s selected 2024 child page. The statewide estimate is retained separately; county and statewide values are not added together.'),
 paragraph('food-county-chart-note','The chart selects the ten highest published county rates in this received source. It is a descriptive ordering of modeled point estimates, without a claim of statistically significant differences.')]),
 section('food-county-income','Children and income thresholds','Percent of food-insecure children · 185% of federal poverty level',[
 paragraph('food-eligibility-denominator','Above-threshold and at/below-threshold percentages use food-insecure children as their denominator. The original report’s Table 10 also contains a measure with all children as its denominator. Those fields remain distinct; the percentages shown here must not be copied into the all-children field.'),
 paragraph('food-program-rules','An income threshold is one part of program rules. The source’s modeled income categories do not show actual receipt, application or denial of benefits.')]),
 section('food-county-cost','Local food costs and budget shortfalls','Geography-wide measures · 2024',[
 paragraph('food-cost-population','The map also displays each county’s average meal cost and annual food-budget shortfall. These are geography-wide measures for the overall population. Their appearance on a child page does not make them child-only amounts.'),
 paragraph('food-cost-definition','The annual shortfall is a modeled estimate derived from food insecurity, reported additional spending needs, and local food prices. It is not a SNAP benefit amount or an appropriation. The retained technical brief explains the calculation.')]),
 section('food-source-revision','Correcting the original food-source year and release','Original report Tables 10 and 13',[
 paragraph('food-table13-year','The original Table 13 labels its heading 2024 and its footer 2022, while its Ohio count of 517,450 and rate of 20.1% match the 2023 source. That original observation is retained as 2023. The current tables in this working edition use the received 2024 source.'),
 paragraph('food-county-revision','Feeding America documents that its previous 2023 county estimates used 2022 unemployment data. The current release revises those county estimates; state and congressional results were unaffected. The following table compares original and revised values for the same 2023 measurement year.',[sourceIds[1],sourceIds[2]]),
 paragraph('food-original-snap-period','The original Table 10’s SNAP participation percentage is labeled 2025 and cites Ohio JFS monthly statistics, without identifying a month. It stays in the original-report concordance rather than being recast as a 2024 food-insecurity measure.')]),
 section('food-history','Historical county estimates retained with the source','Nine Northeast Ohio counties · 2013–2024',[
 paragraph('food-history-coverage','The received historical CSV contains all 108 observations for Ashland, Ashtabula, Cuyahoga, Geauga, Lake, Lorain, Medina, Portage and Summit counties. The complete dataset is editable in the source desk. The printed comparison selects 2023 and 2024 rows.',[sourceIds[2]]),
 paragraph('food-history-comparison','Changes in measurement year, source release and model inputs are separate concepts. The displayed historical values preserve their actual year; descriptive differences do not establish statistical significance or a causal trend.',[sourceIds[1],sourceIds[2]])])
 ];
 const mappings=[];
 const table=(cohort,id,sectionId,title,caption,rowIds,columns)=>mappings.push({cohort,mapping:{id,kind:'table',sectionId,sectionTitle:sections.find(s=>s.id===sectionId).title,blockId:id,title,caption,rowIds,columns}});
 const chart=(cohort,id,sectionId,title,caption,rowIds,labelColumn,valueColumn)=>mappings.push({cohort,mapping:{id,kind:'chart',sectionId,sectionTitle:sections.find(s=>s.id===sectionId).title,blockId:id,title,caption,rowIds,columns:[],labelColumn,valueColumn,chartType:'bar'}});
 table('state','food-ohio-counts','food-ohio','Ohio food insecurity: counts and rates','The two populations overlap; all measures describe 2024.',datasets.state.rows.map(r=>r.id),['population','count','rate']);
 table('state','food-ohio-income','food-ohio','Income thresholds among food-insecure people','Each population uses its displayed threshold. Published rounding is preserved.',datasets.state.rows.map(r=>r.id),['population','threshold_fpl','above_threshold','below_threshold']);
 const counties=datasets.counties.rows;
 for(let i=0;i<counties.length;i+=22){
  const rows=counties.slice(i,i+22),range=rows[0].values.geography.replace(', Ohio','')+' – '+rows[rows.length-1].values.geography.replace(', Ohio',''),part=1+i/22;
  table('counties','food-counties-counts-'+part,'food-county-counts',range,'Food-insecure children under 18, 2024; exact published count and rate.',rows.map(r=>r.id),['geography','count','rate']);
  table('counties','food-counties-income-'+part,'food-county-income',range,'Percent of FOOD-INSECURE children, above or at/below 185% of the federal poverty level.',rows.map(r=>r.id),['geography','above_threshold','below_threshold']);
  table('counties','food-counties-cost-'+part,'food-county-cost',range,'Overall geography-wide food costs in USD, 2024. These are not child-only amounts.',rows.map(r=>r.id),['geography','meal_cost','annual_shortfall']);
 }
 const ranked=[...counties].sort((a,b)=>Number(b.values.rate)-Number(a.values.rate)||a.values.geography.localeCompare(b.values.geography)).slice(0,10);
 chart('counties','food-counties-rate-chart','food-county-counts','Ten highest published county child rates','Percent of all children under 18, 2024. Ordering is descriptive.',ranked.map(r=>r.id),'geography','rate');
 table('revision','food-revision-table','food-source-revision','2023 county release corrections','Same measurement year: original OACAA Table 10 versus the current received source. Difference is percentage points.',datasets.revision.rows.map(r=>r.id),['geography','original_rate','revised_rate','difference_pp']);
 table('history','food-history-recent-table','food-history','Received historical estimates, 2023 and 2024','Current source release; comparison years remain explicit.',datasets.history.rows.filter(r=>['2023','2024'].includes(r.values.period)).map(r=>r.id),['geography','period','count','rate']);
 const cohorts=Object.entries(datasets).map(([key,ds])=>({key,path:'datasets/'+ds.id+'.json',datasetId:ds.id,sha256:sha256Utf8(JSON.stringify(ds,null,2)+'\n').sha256,originals:['sources/FOOD_ORIGINALS.json']}));
 return {schema:'tjl.oacaa.acs-working-plan.v1',measurementPeriod:'2024 current food estimates; explicitly labeled historical observations and 2023 release comparisons',cohorts,sources,sections,mappings,
 sharedOriginals:['FOOD_SOURCE_MANIFEST.json','FOOD_SOURCE_CONCORDANCE.json','FOOD_SOURCE_GUIDE.md','food_reporting.cjs','food_plan.cjs','food-working-plan.json','food_member_graphics.py','food-source-lock.json'],
 concordance:'FOOD_SOURCE_CONCORDANCE.json'};
}

function buildSourceManifest(originals,sha256Utf8) {
 const record=(value,url,label)=>value.representation==="selected-statistical-observation"
  ? {label,sourceUrl:url,representation:"Selected statistical observations extracted from the retained reader response",
     originalResponse:value.original,selectedObservation:sha256Utf8(JSON.stringify(value.observation)),
     locator:value.observation.locator}
  : {label,sourceUrl:url,representation:"Exact UTF-8 public reader response",
     providerFileUploadId:value.file_upload_id,filename:value.filename,...sha256Utf8(value.content)};
 return {schema:"tjl.oacaa.food-source-manifest.v1",retrievedAt:originals.retrievedAt,
  primaryPublisher:"Feeding America",release:"Map the Meal Gap 2026",measurementPeriod:"2024",
  sourceRepresentations:[
   record(originals.stateChild,"https://map.feedingamerica.org/county/2024/child/ohio","Ohio child"),
   record(originals.stateChild2023,"https://map.feedingamerica.org/county/2023/child/ohio","Ohio child — historical 2023 source"),
   record(originals.stateOverall,"https://map.feedingamerica.org/county/2024/overall/ohio","Ohio overall"),
   ...originals.counties.map(r=>({...record(r,r.source_url,r.name),fips:r.fips}))
  ],
  historicalCsv:{sourceUrl:"https://embed-cuyahoga.thehcn.net/indicators/index/indicatorcsv?indicatorId=2108&localeFilterId=0&localeTypeId=2",
   representation:"Exact UTF-8 CSV redistribution",publisher:"Feeding America / Conduent Healthy Communities Institute",
   measurementPeriod:"2013–2024",rows:108,counties:9,
   comparability:{sourceUrl:"https://embed-cuyahoga.thehcn.net/indicators/index/view?indicatorId=2108&localeId=38",locator:"Changes Over Time: Change in methodology for 2018",retrievedDate:"2026-10-13",note:"The source states that methodology changes made in 2020 mean 2018 estimates should not be compared with earlier periods. The selected 2023/2024 comparison is unaffected."},
   ...sha256Utf8(originals.hcnCsv)},
  originalReport:{sourceUrl:"https://oacaa.org/wp-content/uploads/2026/08/2026-state-of-poverty-report_final-low.pdf",
   retainedSource:"sources/FOOD_ORIGINALS.json / table10Selected",locator:"Original Table 10 parts and Table 13",
   representation:"Selected table rows transcribed from the complete retained report OCR; table locators are preserved.",
   fullOcrProvenance:"Complete original report OCR retained in the original internal source workshare"},
  methodology:{sourceUrl:"https://www.feedingamerica.org/sites/default/files/2026-09/Map%20the%20Meal%20Gap%20Technical%20Brief.pdf",
   revisionLocator:"Physical PDF pages 4–5",definitions:"Population, modeled estimates, income eligibility, rounding and geography-wide food costs."},
  note:"Original URLs and representation types stay explicit. Publisher navigation, branding and narrative are retained only in the source records; report content uses attributed statistical facts and original explanation."};
}
function buildLock(fileTexts,sha256Utf8,retrievedAt) {
 return {schema:"tjl.oacaa.food-source-lock.v1",retrievedAt,measurementPeriod:"2024 with separately labeled historical years",
  files:Object.entries(fileTexts).sort(([a],[b])=>a.localeCompare(b)).map(([path,content])=>({path,...sha256Utf8(content)}))};
}
module.exports={buildPlan,buildSourceManifest,buildLock};
if(require.main===module) {
 const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
 const root=path.resolve(process.argv[2]||".");
 const hash=text=>({bytes:Buffer.byteLength(text,"utf8"),sha256:crypto.createHash("sha256").update(text,"utf8").digest("hex")});
 const read=name=>fs.readFileSync(path.join(root,name),"utf8");
 const json=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+"\n");
 const originals=JSON.parse(read("sources/FOOD_ORIGINALS.json"));
 const ids={state:"ohio-food-state-2024",counties:"ohio-food-child-counties-2024",
  history:"ohio-food-child-history-ne-2013-2024",revision:"ohio-food-county-revision-2023"};
 const datasets=Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,JSON.parse(read("datasets/"+id+".json"))]));
 const plan=buildPlan(datasets,hash);
 json("food-working-plan.json",plan);
 json("FOOD_SOURCE_MANIFEST.json",buildSourceManifest(originals,hash));
 const names=[...new Set([...plan.cohorts.flatMap(c=>[c.path,c.path.replace(/\.json$/,'.csv'),...c.originals]),...plan.sharedOriginals])].filter(name=>name!=="food-source-lock.json");
 const texts=Object.fromEntries(names.map(name=>[name,read(name)]));
 json("food-source-lock.json",buildLock(texts,hash,originals.retrievedAt));
 console.log(JSON.stringify({datasets:plan.cohorts.length,sections:plan.sections.length,mappings:plan.mappings.length,
  retainedFiles:names.length,sourceLock:"food-source-lock.json"}));
}

