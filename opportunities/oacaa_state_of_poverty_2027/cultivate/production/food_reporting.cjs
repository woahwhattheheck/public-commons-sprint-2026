'use strict';
/** Rebuild the food-security cohorts from the retained public source representations.
 * No network, inferred population denominator, or survey-year substitution is used.
 * node food_reporting.cjs sources/FOOD_ORIGINALS.json datasets
 */
function parseReader(record, expected){
 if(record.representation==="selected-statistical-observation") {
  const value=record.observation;
  if(!value||record.source_url!==expected.url||value.url!==expected.url||value.name!==expected.name||
     value.fips!==expected.fips||value.population!==expected.population||value.period!==(expected.year||"2024"))
   throw Error("Selected source identity mismatch for "+expected.name);
  if(!record.original||!/^[a-f0-9]{64}$/.test(record.original.sha256)||!Number.isSafeInteger(record.original.bytes)||record.original.bytes<=0)
   throw Error("Retain the complete reader response identity for "+expected.name);
  for(const key of ["count","rate","above","below","threshold","meal","shortfall"])
   if(typeof value[key]!=="string"||!/^[0-9]+(?:\.[0-9]+)?$/.test(value[key]))throw Error("Invalid selected numeric source "+key);
  if(["rate","above","below"].some(key=>Number(value[key])>100)||
     !/^[0-9]+$/.test(value.count)||!/^[0-9]+$/.test(value.shortfall)||
     value.threshold!==(expected.population==="child"?"185":"130"))
   throw Error("Invalid selected population or threshold for "+expected.name);
  return {...value};
 }
 const raw=record.content;
 const year=expected.year||"2024",name=expected.name;
 if(!raw.includes("URL Source: "+expected.url+"\n")) throw Error("Reader source URL mismatch "+name);
 const start=raw.indexOf(year+" Food Insecurity in "+name);
 if(start<0) throw Error("Missing actual selected-year summary for "+name);
 const end=raw.indexOf("_Map the Meal Gap_",start);
 const body=raw.slice(start,end<0?undefined:end);
 const one=(pattern,label)=>{const matches=[...body.matchAll(pattern)];if(matches.length!==1)throw Error("Expected one "+label+" for "+name);return matches[0][1].replace(/,/g,"");};
 const child=expected.population==="child";
 const count=one(child?/## Food insecure Children in [^\n]+\n\n([0-9,]+)\n/g:/## Food insecure People in [^\n]+\n\n([0-9,]+)\n/g,"population");
 const rate=one(/## (?:child )?Food insecurity rate in [^\n]+\n\n([0-9.]+)%/g,"rate");
 const above=one(child?/\n([0-9]+)%\n\nLikely ineligible for federal nutrition programs \(incomes above 185% of poverty\)/g:/\n([0-9]+)%\n\nAbove SNAP threshold/g,"above income threshold");
 const below=one(child?/\n([0-9]+)%\n\nIncome eligible for federal nutrition programs \(incomes at or below 185% of poverty\)/g:/\n([0-9]+)%\n\nBelow SNAP threshold of 130%/g,"below income threshold");
 const meal=one(/## Average meal cost in [^\n]+\n\n\$([0-9,.]+)/g,"meal cost");
 const shortfall=one(/## ANNUAL FOOD BUDGET SHORTFALL\n\n\$([0-9,]+)/g,"budget shortfall");
 if([rate,above,below].some(x=>!Number.isFinite(Number(x))||Number(x)<0||Number(x)>100))throw Error("Invalid published percentage");
 return {name,fips:expected.fips,population:expected.population,period:year,count,rate,above,below,threshold:child?"185":"130",meal,shortfall,url:expected.url,locator:year+" Food Insecurity in "+name,summary:body};
}
function csv(text) {
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(cell);cell='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}
  else cell+=c;
 }if(quoted)throw Error('Unterminated source CSV quote');
 if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
const columns=(defs)=>defs.map(([key,label,kind,role,unit,definition])=>({key,label,kind,role,unit:unit||'',period:'2024',definition}));
const geoNote='Counts are modeled persons living in food-insecure households. A child is under age 18. Counts and percentages are independently rounded as published; no denominator is reverse-engineered.';
const eligibilityNote='Income eligibility among food-insecure children uses 185% of the federal poverty level. It is a share of food-insecure children, not all children, and does not establish actual participation or every program eligibility rule.';
const costNote='Meal cost and annual budget shortfall are geography-wide food-cost measures. They are not child-only costs and are not benefit amounts.';
function dataset(id,title,description,dataPeriod,geography,methodology,source,defs,rows){
 return {schema:'tjl.publication.report-dataset.v1',id,title,description,publicationPeriod:'Map the Meal Gap 2026 source working edition',dataPeriod,geography,methodology,source,columns:columns(defs),rows};
}
function source(title,url,locator,retrievedAt,note,publisher='Feeding America'){
 return {title,url,locator,publisher,retrievedAt,note,rights:'Published statistical facts with attribution. Source representation and original URLs are retained; publisher branding and narrative are not licensed for reuse.'};
}
function buildFood(originals){
 if(originals.schema!=='tjl.oacaa.food-originals.v1')throw Error('Open the retained food-source packet.');
 const at=originals.retrievedAt;
 const historicalState=parseReader(originals.stateChild2023,{name:'Ohio',fips:'39000',population:'child',year:'2023',url:'https://map.feedingamerica.org/county/2023/child/ohio'});
 if(historicalState.count!=='517450'||historicalState.rate!=='20.1')throw Error('Reconcile the original Table 13 observation against its selected 2023 source.');
 const stateChild=parseReader(originals.stateChild,{name:'Ohio',fips:'39000',population:'child',url:'https://map.feedingamerica.org/county/2024/child/ohio'});
 const stateOverall=parseReader(originals.stateOverall,{name:'Ohio',fips:'39000',population:'overall',url:'https://map.feedingamerica.org/county/2024/overall/ohio'});
 if(originals.counties.length!==88)throw Error('The complete Ohio county cohort requires 88 received source pages.');
 const county=originals.counties.map(r=>parseReader(r,{name:r.name+', Ohio',fips:r.fips,population:'child',url:r.source_url}));
 if(new Set(county.map(r=>r.fips)).size!==88||county.some(r=>!/^39[0-9]{3}$/.test(r.fips)||r.fips==='39000'))throw Error('Keep all 88 distinct Ohio county identities.');
 const cdefs=[
 ['geography','Geographic area','text','label','','Original selected Ohio geography.'],
 ['fips','FIPS','text','geography','','Five-digit Census geographic identity, retained separately from the source map URL.'],
 ['period','Data year','text','period','','Measurement year 2024; release 2026.'],
 ['population','Population','text','note','','Child means under 18; overall includes children and adults.'],
 ['count','Food-insecure people','integer','value','persons','Modeled food-insecure persons in this selected population.'],
 ['rate','Food-insecurity rate','decimal','value','percent','Percent of the selected child or overall population.'],
 ['above_threshold','Above income threshold','decimal','value','percent','Share of food-insecure people in the selected population with income above the displayed threshold.'],
 ['below_threshold','At/below displayed threshold','decimal','value','percent','Share of food-insecure children at/below 185% FPL; overall source labels below 130% SNAP threshold.'],
 ['threshold_fpl','Displayed income threshold','decimal','note','percent','Threshold as a percent of the federal poverty level; this is not a participation rate.'],
 ['meal_cost','Average meal cost','decimal','value','USD','Geography-wide modeled average meal cost, not a child-only measure.'],
 ['annual_shortfall','Annual food-budget shortfall','integer','value','USD','Geography-wide annual modeled shortfall across the overall population, not a child-only measure.'],
 ['source_url','Source URL','text','source','','Original selected source page.']
 ];
 const row=r=>({id:'food-'+r.fips+'-'+r.population,values:{geography:r.name,fips:r.fips,period:r.period,population:r.population==='child'?'Children under 18':'All people',
 count:r.count,rate:r.rate,above_threshold:r.above,below_threshold:r.below,threshold_fpl:r.threshold,meal_cost:r.meal,annual_shortfall:r.shortfall,source_url:r.url},
 locator:r.locator,note:geoNote+' '+eligibilityNote+' '+costNote+(r.population==='overall'?' Published rounded eligibility percentages 60 and 41 sum to 101 and remain unchanged.':'')});
 const state=dataset('ohio-food-state-2024','Ohio food insecurity and income thresholds — 2024','Statewide overall and child populations, with exact published counts, rates and program-income thresholds.','2024','Ohio',geoNote+' '+eligibilityNote+' '+costNote,
 source('Feeding America Map the Meal Gap 2026: Ohio','https://map.feedingamerica.org/county/2024/child/ohio','Selected 2024 statewide child and overall pages; exact representations in FOOD_ORIGINALS.json.',at,'Public pages were received through Jina Reader and Notion; dates and selected populations are checked before extraction.'),
 cdefs,[stateOverall,stateChild].map(row));
 const counties=dataset('ohio-food-child-counties-2024','Child food insecurity — all 88 Ohio counties, 2024','Complete county child counts, rates and income-threshold shares with original geography-specific source URLs.','2024','All 88 Ohio counties',geoNote+' '+eligibilityNote+' '+costNote,
 source('Feeding America Map the Meal Gap 2026: Ohio counties','https://map.feedingamerica.org/county/2024/child/ohio','All 88 selected county child pages, year 2024; exact source representations in FOOD_ORIGINALS.json.',at,'Statewide results are separate. County totals are not added to the state row and rounding differences are preserved.'),cdefs,county.map(row));
 const cr=csv(originals.hcnCsv),header=cr.shift();const required=['Location','Indicator Rate Value','Indicator Count Value','Period of Measure','Data Source'];
 const indices=Object.fromEntries(required.map(x=>{const i=header.indexOf(x);if(i<0)throw Error('Missing source CSV column '+x);return[x,i];}));
 const expected=new Set(['Ashland','Ashtabula','Cuyahoga','Geauga','Lake','Lorain','Medina','Portage','Summit']);
 const history=cr.map((r,index)=>{if(r.length!==header.length)throw Error('Source CSV width changed at record '+(index+2));
 const name=r[indices.Location],year=r[indices['Period of Measure']],rate=r[indices['Indicator Rate Value']],count=r[indices['Indicator Count Value']];
 if(!expected.has(name)||!/^20[0-9]{2}$/.test(year)||!/^[0-9]+(?:\.[0-9]+)?$/.test(rate)||count&&!/^[0-9]+$/.test(count)||r[indices['Data Source']]!=='Feeding America')throw Error('Unexpected source CSV record');
 return {id:'food-history-'+name.toLowerCase()+'-'+year,values:{geography:name+' County, Ohio',period:year,rate,count,source:'Feeding America; redistributed by Healthy Northeast Ohio / Conduent HCI'},
 locator:'Original CSV record '+(index+2),note:'Historical published estimate retained from the current redistribution. Empty count cells remain unavailable; they are not zero. Model/release changes limit interpretation of year-to-year differences.'};});
 if(history.length!==108||new Set(history.map(r=>r.id)).size!==108)throw Error('Preserve the complete nine-county 2013–2024 CSV.');
 const hist=dataset('ohio-food-child-history-ne-2013-2024','Child food insecurity history — nine Northeast Ohio counties','Complete received redistribution: nine counties across 2013–2024. The 2023 rows reflect current revised estimates.','2013–2024; each row carries its own year','Ashland, Ashtabula, Cuyahoga, Geauga, Lake, Lorain, Medina, Portage and Summit counties',
 'Current Conduent Healthy Communities Institute CSV redistribution attributes each row to Feeding America. It is retained separately from the 88-county 2024 primary-source cohort. Counts are unavailable for some earlier years. No statistical significance or unadjusted causal trend is inferred.',
 source('Healthy Northeast Ohio child food-insecurity CSV','https://embed-cuyahoga.thehcn.net/indicators/index/indicatorcsv?indicatorId=2108&localeFilterId=0&localeTypeId=2','All 108 records; original CSV headers, years, count blanks and rates retained.',at,'Redistribution maintained by Conduent Healthy Communities Institute, using Feeding America estimates.','Feeding America / Conduent Healthy Communities Institute'),
 [['geography','Geographic area','text','label','','Original county name.'],['period','Data year','text','period','','Original measurement year, not release date.'],
 ['rate','Child food-insecurity rate','decimal','value','percent','Percent of all children under 18 living in food-insecure households.'],
 ['count','Food-insecure children','integer','value','persons','Published modeled count, blank where unavailable.'],['source','Source','text','source','','Explicit original publisher and redistribution.']],history);
 hist.columns.forEach(c=>c.period='2013–2024; row-specific');
 const originalRows=new Map();
 for(const r of originals.table10Selected){if(!/food.*insecurity.*rate/i.test(r.row.join(' ')))continue;
  const vals=r.row.slice(-r.geographies.length);
  r.geographies.forEach((name,i)=>{const matches=vals[i].match(/[0-9]+(?:\.[0-9]+)?%/g)||[];
   if(matches.length===1)originalRows.set(name,{value:matches[0].replace('%',''),locator:'Original 2026 report Table 10 part '+r.tablePart,raw:vals[i]});});
 }
 const comparisons=history.filter(r=>r.values.period==='2023').map(r=>{
  const name=r.values.geography.replace(' County, Ohio',''),old=originalRows.get(name);
  if(!old)throw Error('Missing original Table 10 rate for '+name);
  return {geography:name,measurementPeriod:'2023',originalReportValue:old.value,currentRedistributedValue:r.values.rate,
    originalLocator:old.locator,currentLocator:r.locator,status:Number(old.value)===Number(r.values.rate)?'agrees':'revised-source-value',
    explanation:'Feeding America documents correction of 2023 county estimates because the prior release used 2022 unemployment data. Statewide estimates were unaffected. This compares the same measurement year.'};
 });
 const h2024=new Map(history.filter(r=>r.values.period==='2024').map(r=>[r.values.geography,r]));
 for(const c of county){const h=h2024.get(c.name);if(h&&(Number(h.values.rate)!==Number(c.rate)||h.values.count!==c.count))throw Error('Primary 2024 county page disagrees with received HCI source for '+c.name);}
 const concordance={schema:'tjl.oacaa.food-source-concordance.v1',checkedAt:at,items:[
 {id:'table13-year',originalLocator:'Original 2026 report Table 13',originalHeadingYear:'2024',originalFooterYear:'2022',originalProseYears:'2021→2023',
 originalOhioChildCount:'517450',originalOhioChildRate:'20.1',resolvedMeasurementYear:'2023',
 resolution:'The original statewide count/rate matches Feeding America 2023. Keep that historical observation labeled 2023. The source-current 2024 edition uses 534,640 and 20.8%.',
 sourceUrl:'https://map.feedingamerica.org/county/2023/child/ohio'},
 {id:'county-2023-revision',sourceUrl:'https://www.feedingamerica.org/sites/default/files/2026-09/Map%20the%20Meal%20Gap%20Technical%20Brief.pdf',locator:'Physical PDF pages 4–5',
 resolution:'The 2026 technical brief corrects 2023 county overall, child and income-eligibility estimates after the earlier county release used 2022 BLS unemployment. State and congressional results were unaffected.'},
 {id:'eligibility-denominator',resolution:eligibilityNote+' Original Table 10 percentage of ALL children who are both food insecure and above income eligibility is a different denominator. Do not paste the among-food-insecure 33% into that column.'},
 {id:'rounding',resolution:'The Ohio overall page publishes 60% above and 41% below the SNAP threshold. Retain both; do not alter one to force 100%. Source counts and rates do not provide an exact unrounded denominator.'},
 {id:'cost-universe',resolution:costNote},
 {id:'snap-month',originalLocator:'Original 2026 report Table 10',originalPeriod:'2025',resolution:'The published SNAP percentage cites Ohio JFS monthly statistics without naming the month. The food-security dataset does not relabel it as a 2024 meal-gap measure or infer a month or denominator.'}
 ],countyComparisons:comparisons,coverage:{currentPrimaryCounties:county.length,currentStatePopulations:2,historicalCounties:9,historicalRows:history.length}};
 const revision=dataset('ohio-food-county-revision-2023','Revised 2023 county child estimates — original report comparison',
 'Nine same-year comparisons between the original report Table 10 and the current source redistribution. These are release corrections, not changes between measurement years.',
 '2023, compared across releases','Nine Northeast Ohio counties',
 'The original report transcription is retained with its table-part locators. Revised values come from the complete received county CSV. Differences use tenths of one percentage point; no significance inference is made.',
 source('OACAA Table 10 and revised Feeding America county estimates','https://www.feedingamerica.org/sites/default/files/2026-09/Map%20the%20Meal%20Gap%20Technical%20Brief.pdf',
 'Technical brief physical pages 4–5; original report Table 10 and current HCI CSV 2023 rows.',at,'The publisher states that the previous county release used the wrong unemployment year. This correction did not affect statewide results.'),
 [['geography','County','text','label','','Original county identity.'],['period','Data year','text','period','','Both values describe 2023.'],
 ['original_rate','Original report rate','decimal','value','percent','Child rate printed in the original OACAA Table 10.'],
 ['revised_rate','Revised source rate','decimal','value','percent','Current redistribution of Feeding America 2023 county estimate.'],
 ['difference_pp','Revision difference','decimal','value','percentage points','Revised source rate minus original report rate; same data year.']],
 comparisons.map(r=>({id:'food-revision-'+r.geography.toLowerCase(),values:{geography:r.geography+' County, Ohio',period:'2023',
 original_rate:r.originalReportValue,revised_rate:r.currentRedistributedValue,
 difference_pp:((Math.round(Number(r.currentRedistributedValue)*10)-Math.round(Number(r.originalReportValue)*10))/10).toFixed(1)},
 locator:r.originalLocator+'; '+r.currentLocator,note:r.explanation})));
 revision.columns.forEach(c=>c.period='2023');
 return {datasets:{state,counties,history:hist,revision},concordance};
}

function selectPublicSources(originals,sha256Utf8) {
 const project=(record,expected)=>{
  if(record.representation==="selected-statistical-observation")return {...record};
  const observation=parseReader(record,expected);delete observation.summary;
  return {representation:"selected-statistical-observation",name:record.name||expected.name,
   fips:expected.fips,source_url:expected.url,
   original:{representation:"Complete UTF-8 public-reader text",...sha256Utf8(record.content)},
   observation};
 };
 return {schema:originals.schema,retrievedAt:originals.retrievedAt,
  representation:"Statistical observations extracted from exact retained source responses",
  stateChild:project(originals.stateChild,{name:"Ohio",fips:"39000",population:"child",url:"https://map.feedingamerica.org/county/2024/child/ohio"}),
  stateChild2023:project(originals.stateChild2023,{name:"Ohio",fips:"39000",population:"child",year:"2023",url:"https://map.feedingamerica.org/county/2023/child/ohio"}),
  stateOverall:project(originals.stateOverall,{name:"Ohio",fips:"39000",population:"overall",url:"https://map.feedingamerica.org/county/2024/overall/ohio"}),
  counties:originals.counties.map(r=>project(r,{name:r.name+", Ohio",fips:r.fips,population:"child",url:r.source_url})),
  hcnCsv:originals.hcnCsv,table10Selected:originals.table10Selected};
}

function datasetCsv(ds) {
 const quote=value=>'"'+String(value).replace(/"/g,'""')+'"';
 const rows=[ds.columns.map(c=>c.key),...ds.rows.map(row=>ds.columns.map(col=>{
  const value=row.values[col.key];
  return col.kind==="text"&&/^[\s]*[=+@-]/.test(value)?"'"+value:value;
 }))];
 return rows.map(row=>row.map(quote).join(",")).join("\r\n")+"\r\n";
}
module.exports={buildFood,parseReader,csv,selectPublicSources,datasetCsv};
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path');
 const input=process.argv[2]||'sources/FOOD_ORIGINALS.json',out=process.argv[3]||'datasets';
 const built=buildFood(JSON.parse(fs.readFileSync(input,'utf8')));fs.mkdirSync(out,{recursive:true});
 for(const ds of Object.values(built.datasets)){
  fs.writeFileSync(path.join(out,ds.id+'.json'),JSON.stringify(ds,null,2)+'\n');
  fs.writeFileSync(path.join(out,ds.id+'.csv'),datasetCsv(ds));
 }
 fs.writeFileSync('FOOD_SOURCE_CONCORDANCE.json',JSON.stringify(built.concordance,null,2)+'\n');
 console.log(JSON.stringify({datasets:Object.keys(built.datasets).length,rows:Object.fromEntries(Object.entries(built.datasets).map(([key,v])=>[key,v.rows.length]))}));
}
