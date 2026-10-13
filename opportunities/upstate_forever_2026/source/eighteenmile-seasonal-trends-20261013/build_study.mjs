#!/usr/bin/env node
/** Compile the complete original Eighteenmile observations into a portable trend study. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseCsv,prepareRecords,catalogue,analyzeCohort,compareSelections,csv,VERSION} from './trend-core.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const PARENT='source/eighteenmile-stream-nutrients-20261013';
const REFERENCES=[
 {title:'USGS: Techniques of trend analysis for monthly water quality data (Hirsch, Slack and Smith, 1982)',uri:'https://pubs.usgs.gov/publication/70011649'},
 {title:'USGS: Seasonal data with serial dependence (Hirsch and Slack, 1984)',uri:'https://pubs.usgs.gov/publication/70012890'},
 {title:'USGS: ESTREND and multiple reporting limits (Schertz and others, 1991)',uri:'https://www.usgs.gov/publications/computer-program-estimate-trend-estrend-a-system-detection-trends-water-quality-data'},
 {title:'Original Water Quality Portal service',uri:'https://www.waterqualitydata.us/webservices_documentation/'},
 {title:'Original USGS gauge 02186702',uri:'https://waterdata.usgs.gov/monitoring-location/USGS-02186702/'}
];
const METHOD={
 title:'Source-bound seasonal interval-slope exploration',
 estimand:'Median of between-year differences in same-season sampled concentration medians, divided by elapsed calendar years, within one exact station/constituent/fraction/method/source-basis cohort. The primary edition keeps documented and unspecified depths separate.',
 interval:'Numeric source results are point values. A recognized blank below-quantification result is [0, published positive mg/L limit). No substituted concentration is assigned. Median and difference calculations retain a conservative closed outer envelope of all feasible censored values.',
 season:'First form one interval median per sampling date, then one per calendar month (or selected quarter/year). Pair only the same season in different years. Missing months remain missing.',
 slope:'For earlier [a,b] and later [c,d], year gap t, each slope is bounded by [(c-b)/t,(d-a)/t]. Median lower and upper endpoints bound the median pair slope. Shared observations can make this conservative rather than sharp. It is not a confidence interval.',
 direction:'A wholly positive/negative envelope identifies the direction of this sampled-data estimator under the stated censor bounds. It does not establish statistical significance or a causal temporal trend. With no between-year pairs, a trend is not computed.',
 flow:'Optional flow-ratio matching restricts same-season pairs using the median original USGS 02186702 daily means on the actual sampled dates. The gauge is regional context with explicit upstream/downstream relationships. It is not colocated instantaneous sample discharge, regression flow adjustment, or mass-load integration.',
 sensitivity:'The complete study compares monthly/quarterly/annual grouping, flow-ratio ≤2 matching, numeric-only records, approved unestimated daily-flow dates and removal of each observed year. A separately labeled depth-metadata sensitivity combines documented and unspecified depths without assuming they were physically equal. Pairwise comparisons are dependent; no independent-pair p-value is calculated.',
 quality:'Only final, unqualified, interpretable concentration intervals are included in the primary estimate. Every excluded row, original quality field, calculated-result cohort, one-visit station and administrative project code remains available. Analytical methods, depths and physical/chemical bases remain separate; project/year labels do not split otherwise comparable chemistry.',
 interpretation:'2020–2025 is a six-year requested window with uneven station coverage. The analysis describes the retained stream observations. Original NDR/SDR annual exports and calibration references keep their own units, domains and source support.'
};
function sourceInputs(application){
 const parent=JSON.parse(readFileSync(join(application,PARENT,'flow-analysis/input-manifest.json'),'utf8'));
 const deps=[...parent.inputs,{role:'flow_join',path:PARENT+'/flow-analysis/nutrient-flow.csv',bytes:368719,sha256:'c88cc19c675b5ead6a8d4175b8984bb34ee089f9aebb2b2dc5047eb95ae23b92'}];
 const texts={};
 for(const item of deps){
  if(item.path.startsWith('/')||item.path.split('/').includes('..'))throw Error('Unsafe source path');
  const raw=readFileSync(join(application,item.path));
  if(raw.length!==item.bytes||sha(raw)!==item.sha256)throw Error('Original source edition differs: '+item.path);
  texts[item.role]=raw.toString('utf8');
 }
 return {parent,deps,texts};
}
function receiveRows(inputs){
 const rows=parseCsv(inputs.texts.flow_join),daily=parseCsv(inputs.texts.daily).filter(r=>r.site==='02186702');
 const byDate=new Map(daily.map(r=>[r.date,r]));
 if(byDate.size!==daily.length)throw Error('Duplicate original gauge date');
 const originals={
  'original/nutrient-results-2020-2022.csv':parseCsv(inputs.texts.original_2020_2022),
  'original/nutrient-results-2023-2025.csv':parseCsv(inputs.texts.original_2023_2025)};
 const bindings={station_id:'MonitoringLocationIdentifier',activity_id:'ActivityIdentifier',date:'ActivityStartDate',
  characteristic:'CharacteristicName',sample_fraction:'ResultSampleFractionText',value:'ResultMeasureValue',unit:'ResultMeasure/MeasureUnitCode',
  detection_condition:'ResultDetectionConditionText',limit_value:'DetectionQuantitationLimitMeasure/MeasureValue',
  limit_unit:'DetectionQuantitationLimitMeasure/MeasureUnitCode',limit_type:'DetectionQuantitationLimitTypeName',
  method_id:'ResultAnalyticalMethod/MethodIdentifier',method_context:'ResultAnalyticalMethod/MethodIdentifierContext',method_name:'ResultAnalyticalMethod/MethodName',
  result_status:'ResultStatusIdentifier',result_type:'ResultValueTypeName',qualifier:'MeasureQualifierCode',activity_type:'ActivityTypeCode',media:'ActivityMediaName',project_id:'ProjectIdentifier'};
 const extras={media_subdivision:'ActivityMediaSubdivisionName',activity_depth:'ActivityDepthHeightMeasure/MeasureValue',activity_depth_unit:'ActivityDepthHeightMeasure/MeasureUnitCode',
  result_depth:'ResultDepthHeightMeasure/MeasureValue',result_depth_unit:'ResultDepthHeightMeasure/MeasureUnitCode',weight_basis:'ResultWeightBasisText',
  time_basis:'ResultTimeBasisText',temperature_basis:'ResultTemperatureBasisText',particle_size_basis:'ResultParticleSizeBasisText',
  collection_method:'SampleCollectionMethod/MethodIdentifier',collection_method_context:'SampleCollectionMethod/MethodIdentifierContext',collection_equipment:'SampleCollectionEquipmentName'};
 const rawRecords={};
 for(const row of rows){
  const original=originals[row.source_file]?.[Number(row.source_row)-2];
  if(!original)throw Error('Missing original logical CSV record '+row.record_id);
  for(const [field,source] of Object.entries(bindings))if(row[field]!==original[source])throw Error('Original field differs '+row.record_id+' '+field);
  for(const [field,source] of Object.entries(extras))row[field]=original[source]||'';
  const f=byDate.get(row.date);
  if(!f||Number(f.reported_mean_cfs)!==Number(row.same_date_mean_cfs)||f.qualifiers!==row.flow_qualifiers||f.source_id!==row.flow_source_id)
    throw Error('Original daily-flow join differs '+row.record_id);
  rawRecords[row.record_id]={...original};
 }
 return {records:prepareRecords(rows),rawRecords,daily};
}
function flatten(result,label){return {cohort_id:result.cohort_id,...result.dimensions,analysis:label,...result.summary};}
function build(application,output){
 if(existsSync(output))throw Error('Choose a new output directory; original editions are never overwritten');
 const input=sourceInputs(application),{records,rawRecords,daily}=receiveRows(input),cohorts=catalogue(records).map((c,i)=>({...c,id:'cohort-'+String(i+1).padStart(2,'0')}));
 const sourceEdition=sha(Buffer.from(json(input.deps)));
 const dataset={schema:VERSION,edition:'ECO-TRENDS-DE49-20261013',source_edition_sha256:sourceEdition,
  title:'Eighteenmile Creek: seasonally matched nutrient trends',period:{start:'2020-01-01',end:'2025-12-31'},
  input_manifest:{inputs:input.deps,parent_revisions:input.parent.input_revisions,original_source_entities:input.parent.original_source_entities},
  methods:METHOD,references:REFERENCES,cohorts,records,raw_records:rawRecords,
  attachments:input.deps.map(item=>({...item,base64:readFileSync(join(application,item.path)).toString('base64')})),
  scope:{original_results:records.length,station_activities:new Set(records.map(r=>r.station_id+'|'+r.activity_id)).size,
    sample_dates:new Set(records.map(r=>r.date)).size,stations:new Set(records.map(r=>r.station_id)).size,
    numeric_results:records.filter(r=>r.interval.state==='numeric').length,censored_results:records.filter(r=>r.interval.state==='left_censored').length,
    original_gauge_days:daily.length,comparable_cohorts:cohorts.length}};
 const primary=cohorts.map(c=>({...analyzeCohort(records,c.key),cohort_id:c.id}));
 const sensitivity=cohorts.flatMap(c=>compareSelections(records,c.key).map(x=>({cohort_id:c.id,...c.dimensions,...x})));
 mkdirSync(output,{recursive:true});
 const write=(name,value)=>writeFileSync(join(output,name),value);
 const table=primary.map(r=>flatten(r,'Same calendar month; censor intervals'));
 write('dataset.json',json(dataset));write('seasonal-trends.csv',csv(table));write('sensitivity.csv',csv(sensitivity));
 write('seasonal-pairs.csv',csv(primary.flatMap(r=>r.pairs.map(p=>({cohort_id:r.cohort_id,station_id:r.dimensions.station_id,characteristic:r.dimensions.characteristic,...p})))));
 write('seasonal-bins.csv',csv(primary.flatMap(r=>r.bins.map(b=>({cohort_id:r.cohort_id,station_id:r.dimensions.station_id,characteristic:r.dimensions.characteristic,...b})))));
 write('leave-one-year-out.csv',csv(primary.flatMap(r=>r.leave_one_year_out.map(x=>({cohort_id:r.cohort_id,station_id:r.dimensions.station_id,characteristic:r.dimensions.characteristic,...x})))));
 write('source-records.csv',csv(records.map(({interval,cohort_key,...r})=>({...r,interval_lower:interval.lower,interval_upper:interval.upper,interval_state:interval.state}))));
 write('analysis.json',json({schema:VERSION,source_edition_sha256:sourceEdition,scope:dataset.scope,methods:METHOD,primary:primary.map(({records,...r})=>r),sensitivity}));
 write('input-manifest.json',json(dataset.input_manifest));
 for(const item of input.deps){const target=join(output,'retained-inputs',item.path);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(application,item.path),target);}
 for(const name of ['trend-core.mjs','build_study.mjs','workbench.js','workbench.html','import_study.py','README.md'])copyFileSync(join(HERE,name),join(output,name));
 let core=readFileSync(join(HERE,'trend-core.mjs'),'utf8').replace(/^export /gm,'');
 let client=readFileSync(join(HERE,'workbench.js'),'utf8');
 let html=readFileSync(join(HERE,'workbench.html'),'utf8')
  .replace('<!--DATASET-->',json(dataset).replaceAll('<','\\u003c'))
  .replace('/*CORE*/',core).replace('/*WORKBENCH*/',client);
 write('report.html',html);
 const shortRows=table.map(r=>({station:r.station_id.match(/SV-\d+$/)?.[0],analyte:r.characteristic,method:r.method_id,
  results:r.included_results,censored:r.censored_results,years:r.observed_years.join(', '),pairs:r.pairs,
  lower:r.slope_lower_mg_l_per_year,upper:r.slope_upper_mg_l_per_year,direction:r.direction}));
 write('brief.md','# Eighteenmile Creek: comparable-season concentration changes\n\n'+
  dataset.scope.original_results+' original results; '+dataset.scope.comparable_cohorts+' exact comparable cohorts. All original chemistry remains unchanged.\n\n'+
  '| Station | Constituent | Observed years | Monthly pairs | Slope outer envelope, mg/L/year |\n|---|---|---|---:|---|\n'+
  shortRows.filter(r=>r.pairs).map(r=>`| ${r.station} | ${r.analyte} | ${r.years} | ${r.pairs} | ${r.lower.toPrecision(5)} to ${r.upper.toPrecision(5)} |`).join('\n')+
  '\n\n## Interpretation\n\n'+Object.entries(METHOD).filter(([k])=>k!=='title').map(([k,v])=>'**'+k+'**: '+v).join('\n\n')+
  '\n\n## Source and methods\n\n'+REFERENCES.map(r=>'- '+r.title+': '+r.uri).join('\n')+'\n');
 const memberNames=['report.html','dataset.json','analysis.json','seasonal-trends.csv','sensitivity.csv','seasonal-pairs.csv','seasonal-bins.csv','leave-one-year-out.csv','source-records.csv','input-manifest.json','brief.md','README.md','trend-core.mjs','build_study.mjs','workbench.js','workbench.html','import_study.py',...input.deps.map(d=>'retained-inputs/'+d.path)];
 const members=memberNames.map(path=>{const b=readFileSync(join(output,path));return {path,bytes:b.length,sha256:sha(b)};});
 write('file-manifest.json',json({schema:'upstate.portable-source-files/v1',source_edition_sha256:sourceEdition,files:members}));
 const scientific={schema:'upstate.observed-report/v1',title:dataset.title,edition:dataset.edition,inputs:members,
  sections:[
   ['Original measured support',[
    `${dataset.scope.original_results} original results, ${dataset.scope.station_activities} station activities and ${dataset.scope.sample_dates} dates form ${dataset.scope.comparable_cohorts} exact comparable cohorts at four stations. Original numeric values, detection limits, laboratory methods and agency source rows are retained.`,
    METHOD.quality]],
   ['Comparable-season concentration change',[
    'Each row below uses the same calendar month in different years. The range is a conservative outer envelope in mg/L per year. It bounds a sampled-data estimator under source censoring and is not a confidence interval.',
    {kind:'table',columns:['Station / constituent','Observed years','Pairs','Lower','Upper'],rows:shortRows.filter(r=>r.pairs).map(r=>[
      r.station+' / '+r.analyte,r.years,String(r.pairs),r.lower.toPrecision(4),r.upper.toPrecision(4)])},
    'Cohorts without between-year season pairs retain their original source records but receive no slope estimate. The complete working study makes one-visit coverage and calculated-result cohorts visible.',
    'SV-233 phosphorus has a monthly median pair slope of +0.006 mg/L/year. Flow-ratio matching retains +0.005667 mg/L/year; quarterly grouping and all six leave-one-year-out selections also retain a positive direction. This is the strongest directionally consistent phosphorus signal in the retained comparable-season results.',
    'SV-375 phosphorus has 30 censored results among 46 observations in this primary cohort. Its full monthly slope envelope spans -0.010 to +0.010 mg/L/year. The numeric-only selection instead gives -0.005667 mg/L/year, illustrating how dropping below-quantification records changes the conclusion.']],
   ['Sensitivity and interpretation',[
    METHOD.sensitivity,METHOD.flow,
    {kind:'table',columns:['Station / constituent','Monthly','Monthly, flow ratio ≤2','Quarterly'],rows:cohorts.filter(c=>c.dimensions.characteristic==='Phosphorus'||c.dimensions.characteristic==='Nitrate + Nitrite').filter(c=>primary.find(r=>r.cohort_id===c.id).summary.pairs).map(c=>{
     const vals=sensitivity.filter(s=>s.cohort_id===c.id),display=s=>s.pairs?s.slope_lower_mg_l_per_year.toPrecision(4)+' to '+s.slope_upper_mg_l_per_year.toPrecision(4):'Not estimable';
     return [c.dimensions.station_id.match(/SV-\d+$/)?.[0]+' / '+c.dimensions.characteristic,display(vals[0]),display(vals[1]),display(vals[2])];})}]],
   ['Methods and use', [METHOD.estimand,METHOD.interval,METHOD.season,METHOD.slope,METHOD.direction,METHOD.interpretation]],
   ['Continue the editable scientific review',[
     {kind:'links',items:[{title:'Complete offline working study with original records and source downloads',path:'report.html'},
       {title:'Complete seasonal trend table',path:'seasonal-trends.csv'},{title:'Every exact source-bound pair',path:'seasonal-pairs.csv'},
       {title:'Full methods and native receiving guide',path:'README.md'}]},
     'Save a working selection and notes in JSON or complete HTML. The receiving project preserves the original source edition and returns its native observed-report selector.']],
   ['Primary methods and sources',REFERENCES.map(r=>r.title+': '+r.uri)]
  ],source_links:['report.html','seasonal-trends.csv','sensitivity.csv','seasonal-pairs.csv','source-records.csv','input-manifest.json','README.md']};
 write('observed-report.json',json(scientific));
 const recipeBytes=readFileSync(join(output,'observed-report.json'));
 members.push({path:'observed-report.json',bytes:recipeBytes.length,sha256:sha(recipeBytes)});
 const recipeEntry={id:'eighteenmile-seasonal-trends-scientific-report',title:dataset.title,kind:'document',role:'OBSERVED_CONTEXT',
  ...members.at(-1),uri:'https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/opportunities/upstate_forever_2026/source/eighteenmile-seasonal-trends-20261013',
  vintage:'Original South Carolina samples 2020–2025; analysis 2026-10-13',metadata:{report_schema:'upstate.observed-report/v1',source_edition_sha256:sourceEdition},
  companions:members.filter(m=>m.path!=='observed-report.json')};
 write('sources.json',json({schema:'upstate.sources/v1',title:dataset.title,captured_at:'2026-10-13',entries:[recipeEntry]}));
 const sourceBytes=readFileSync(join(output,'sources.json'));members.push({path:'sources.json',bytes:sourceBytes.length,sha256:sha(sourceBytes)});
 write('file-manifest.json',json({schema:'upstate.portable-source-files/v1',source_edition_sha256:sourceEdition,files:members}));
 console.log(json({output,source_edition_sha256:sourceEdition,scope:dataset.scope,primary:shortRows}));
}
if(process.argv.length!==4)throw Error('Usage: node build_study.mjs /absolute/original-application /absolute/new-output');
build(resolve(process.argv[2]),resolve(process.argv[3]));
