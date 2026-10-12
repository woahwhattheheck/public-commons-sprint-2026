// MIT. Descriptive cohort analysis of an already validated retained ClinicalTrials edition.
// No registry request, patient matching, clinical inference or acquisition occurs here.
const ANALYSIS='sf88-clinicaltrials-cohort-analysis-v1';
const SHA=/^[a-f0-9]{64}$/, NCT=/^NCT[0-9]{8}$/;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const requireValue=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const compareText=(a,b)=>a<b?-1:a>b?1:0;
const clone=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
const text=value=>typeof value==='string'?value:null;
const values=value=>Array.isArray(value)?value.filter(item=>typeof item==='string'):[];
const unique=value=>[...new Set(values(value))];
const display=value=>value===null||value===undefined?'Not reported':String(value);
const html=value=>display(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const markdown=value=>display(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\\u0060*_\[\]{}()!#|~]/g,c=>'\\'+c).replace(/[\r\n]+/g,' ');
const DATE=/^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?$/;
function date(value){
 const original=object(value)?clone(value):typeof value==='string'?{date:value}:null;
 if(original===null)return null;
 const match=typeof original.date==='string'?DATE.exec(original.date):null;
 return {...original,precision:match?(match[3]?'day':match[2]?'month':'year'):'unrecognized'};
}
const studyCount=(rows,predicate=()=>true)=>new Set(rows.filter(predicate).map(row=>row.nctId)).size;
function repeatedStudies(rows){
 const studies=new Map();
 for(const row of rows){
  let study=studies.get(row.nctId);
  if(!study){study={nctId:row.nctId,occurrences:0,variants:new Map()};studies.set(row.nctId,study);}
  study.occurrences++;
  let variant=study.variants.get(row.source.recordSha256);
  if(!variant){variant={recordSha256:row.source.recordSha256,recordBytes:row.source.recordBytes,occurrenceIds:[]};study.variants.set(row.source.recordSha256,variant);}
  variant.occurrenceIds.push(row.occurrenceId);
 }
 return [...studies.values()].filter(row=>row.occurrences>1).map(row=>({
  nctId:row.nctId,occurrences:row.occurrences,variantCount:row.variants.size,changed:row.variants.size>1,
  variants:[...row.variants.values()].sort((a,b)=>compareText(a.recordSha256,b.recordSha256))
 })).sort((a,b)=>compareText(a.nctId,b.nctId));
}
function countGroups(rows,pick,{multiple=false,label=display}={}){
 const groups=new Map(),denominator=studyCount(rows);
 for(const row of rows){
  const selected=multiple?[...new Set(pick(row))]:[pick(row)];
  for(const value of selected){
   const key=JSON.stringify(value);
   let entry=groups.get(key);
   if(!entry){entry={key,value:clone(value),label:label(value),occurrences:0,ids:new Set()};groups.set(key,entry);}
   entry.occurrences++;entry.ids.add(row.nctId);
  }
 }
 return [...groups.values()].map(({ids,...row})=>({...row,count:ids.size,studyIds:[...ids].sort(compareText),denominator,
  percent:denominator?Number((100*ids.size/denominator).toFixed(2)):0}))
  .sort((a,b)=>b.count-a.count||compareText(a.label,b.label)||compareText(a.key,b.key));
}
function summaries(rows){
 return {
  statuses:countGroups(rows,row=>row.status),
  studyTypes:countGroups(rows,row=>row.studyType),
  phaseCombinations:countGroups(rows,row=>row.phaseCombination,
   {label:value=>value.length?value.join(' + '):'No phase reported'}),
  conditions:countGroups(rows,row=>row.conditions,{multiple:true}),
  sponsors:countGroups(rows,row=>row.sponsorName),
  interventionTypes:countGroups(rows,row=>row.interventionTypes,{multiple:true}),
  resultsFlags:countGroups(rows,row=>row.hasResults,
   {label:value=>value===true?'Reported true':value===false?'Reported false':'Not reported'}),
  resultsSections:countGroups(rows,row=>row.resultsSections,{multiple:true}),
  resultsCoverage:countGroups(rows,row=>({flag:row.hasResults,sectionsPresent:row.resultsSections.length>0}),
   {label:value=>(value.flag===true?'True':value.flag===false?'False':'Not reported')+
     ' / '+(value.sectionsPresent?'result sections retained':'no result sections retained')}),
  enrollmentTypes:countGroups(rows,row=>row.enrollment.type),
  enrollmentReporting:{withValue:studyCount(rows,row=>row.enrollment.count!==null),
   zero:studyCount(rows,row=>row.enrollment.count!==null&&/^[+-]?0(?:\.0*)?(?:e[+-]?[0-9]+)?$/i.test(row.enrollment.count)),
   notReported:studyCount(rows,row=>row.enrollment.count===null)},
  primaryOutcomes:{withRegisteredMeasures:studyCount(rows,row=>row.primaryOutcomes.length>0),
   notReported:studyCount(rows,row=>row.primaryOutcomes.length===0)},
  missing:{status:studyCount(rows,row=>row.status===null),
   studyType:studyCount(rows,row=>row.studyType===null),
   phase:studyCount(rows,row=>row.phases.length===0),
   conditions:studyCount(rows,row=>row.conditions.length===0),
   sponsor:studyCount(rows,row=>row.sponsorName===null),
   resultsFlag:studyCount(rows,row=>row.hasResults===null)}
 };
}
function rowFromResult(result,captureId){
 requireValue(object(result),'CLINICALTRIALS_ANALYSIS_SOURCE_REQUIRED');
 const meta=result.metadata;
 requireValue(NCT.test(result.id??'')&&object(meta)&&
  meta.nctId===result.id&&meta.captureId===captureId&&SHA.test(meta.recordSha256??'')&&
  Number.isSafeInteger(meta.recordBytes)&&meta.recordBytes>0&&
  Number.isSafeInteger(meta.pageIndex)&&meta.pageIndex>=0&&
  Number.isSafeInteger(meta.pageStudyIndex)&&meta.pageStudyIndex>=0&&
  SHA.test(meta.pageSha256??'')&&result.url==='https://clinicaltrials.gov/study/'+result.id,
  'CLINICALTRIALS_ANALYSIS_SOURCE_REQUIRED');
 const enrollment=object(meta.enrollment)?meta.enrollment:{};
 const count=own(enrollment,'count')?enrollment.count:null;
 requireValue(count===null||typeof count==='string','CLINICALTRIALS_ANALYSIS_EXACT_ENROLLMENT_REQUIRED');
 requireValue(meta.hasResults===null||meta.hasResults===undefined||typeof meta.hasResults==='boolean',
  'CLINICALTRIALS_ANALYSIS_RESULTS_FLAG_INVALID');
 const phases=values(meta.phases),interventions=Array.isArray(meta.interventions)?clone(meta.interventions):[];
 return {
  occurrenceId:captureId+'/'+meta.pageIndex+'/'+meta.pageStudyIndex,
  nctId:result.id,title:text(meta.title)??text(result.title)??result.id,officialTitle:text(meta.officialTitle),
  url:result.url,status:text(meta.status),statusVerifiedDate:text(meta.statusVerifiedDate),
  studyType:text(meta.studyType),phases:clone(phases),phaseCombination:[...new Set(phases)].sort(compareText),
  phaseKey:JSON.stringify([...new Set(phases)].sort(compareText)),
  conditions:unique(meta.conditions),interventions,
  interventionTypes:[...new Set(interventions.filter(object).map(row=>text(row.type)).filter(value=>value!==null))],
  sponsorName:object(meta.sponsor)?text(meta.sponsor.name):null,sponsor:clone(meta.sponsor),
  hasResults:meta.hasResults??null,resultsSections:unique(meta.resultsSections),
  enrollment:{count,type:text(enrollment.type),reported:count!==null},
  dates:{start:date(meta.start),primaryCompletion:date(meta.primaryCompletion),completion:date(meta.completion),
   lastUpdatePosted:date(meta.lastUpdatePosted),resultsFirstPosted:date(meta.resultsFirstPosted)},
  primaryOutcomes:Array.isArray(meta.primaryOutcomes)?clone(meta.primaryOutcomes):[],
  source:{captureId,pageIndex:meta.pageIndex,pageStudyIndex:meta.pageStudyIndex,
   pageUrl:text(meta.pageUrl),pageSha256:meta.pageSha256,
   recordSha256:meta.recordSha256,recordBytes:meta.recordBytes}
 };
}
function overview(rows,groups,repeated){
 if(rows.length===0)return ['This selection contains no retained study records. The original capture remains available.'];
 const count=studyCount(rows),observations=[];
 const describe=(name,items)=>{
  if(items.length){const top=items[0];observations.push(name+': '+top.label+' is the largest group ('+
   top.count+' of '+count+' distinct studies; '+top.percent+'%).');}
 };
 describe('Study status',groups.statuses);describe('Study type',groups.studyTypes);describe('Phase combination',groups.phaseCombinations);
 const reported=groups.resultsFlags.find(row=>row.value===true)?.count??0;
 const sections=studyCount(rows,row=>row.resultsSections.length>0);
 observations.push('The source hasResults flag is true in retained records for '+reported+' studies. Result-section content is retained for '+
  sections+' studies. These are separate observations of registry reporting.');
 observations.push('Registered primary outcome measures are retained for '+groups.primaryOutcomes.withRegisteredMeasures+
  ' studies. Protocol outcome measures and posted result sections are reported separately.');
 observations.push('Enrollment is reported for '+groups.enrollmentReporting.withValue+' studies, including '+
  groups.enrollmentReporting.zero+' with a reported zero. Enrollment values and ACTUAL/ESTIMATED labels stay at record level.');
 if(repeated.length){
  const changed=repeated.filter(row=>row.changed).length;
  observations.push(repeated.length+' study IDs have repeated records across the retained source; '+changed+
   ' have different retained record versions. All '+rows.length+' selected records remain available. Group counts use distinct study IDs; changed records can place one study in multiple groups.');
 }
 return observations;
}
export function analyzeClinicalTrialsCohort(edition,{editionSha256}={}){
 requireValue(object(edition)&&edition.schema==='sf88-research-results-v1'&&
  edition.provider==='clinicaltrials-gov'&&edition.success===true&&Array.isArray(edition.results)&&
  object(edition.usage)&&object(edition.sourcePacket)&&Array.isArray(edition.sourcePages)&&
  edition.sourcePages.every(object)&&typeof edition.usage.complete==='boolean'&&SHA.test(editionSha256??'')&&
  SHA.test(edition.sourcePacket.sha256??'')&&typeof edition.usage.captureId==='string'&&
  edition.usage.occurrences===edition.results.length,'CLINICALTRIALS_ANALYSIS_EDITION_REQUIRED');
 const positions=new Set(),rows=[];
 for(const result of edition.results){
  const row=rowFromResult(result,edition.usage.captureId);
  requireValue(!positions.has(row.occurrenceId),'CLINICALTRIALS_ANALYSIS_DUPLICATE_SOURCE_POSITION');
  positions.add(row.occurrenceId);rows.push(row);
 }
 rows.sort((a,b)=>compareText(a.nctId,b.nctId)||a.source.pageIndex-b.source.pageIndex||a.source.pageStudyIndex-b.source.pageStudyIndex);
 const groups=summaries(rows),repeated=repeatedStudies(rows),count=studyCount(rows);
 const source={editionSha256,packetSha256:edition.sourcePacket.sha256,
  manifestSha256:edition.sourcePacket.manifestSha256,captureId:edition.usage.captureId,
  sourceId:edition.usage.sourceId,sourceSha256:edition.usage.sourceSha256,
  coverage:edition.usage.coverage,complete:edition.usage.complete,
  providerTotal:edition.usage.providerTotal??null,captureStudies:count,captureOccurrences:rows.length,repeatedStudies:repeated,
  sourcePages:clone(edition.sourcePages),sourceVersion:clone(edition.usage.sourceVersion),
  configuration:clone(edition.usage.scope),createdAt:edition.usage.createdAt??null,
  completedAt:edition.usage.completedAt??null,stoppedReason:edition.usage.stoppedReason??null};
 return {schema:ANALYSIS,question:text(edition.query)??'',label:text(edition.label)??'Retained trial cohort',
  source,filters:null,selectedStudies:count,selectedOccurrences:rows.length,excludedStudies:0,excludedOccurrences:0,rows,
  repeatedStudies:repeated,groups,observations:overview(rows,groups,repeated),
  methods:[
   'One row is one original study occurrence at a retained source page and row position; repeated NCT IDs and changed record versions remain visible.',
   'Group counts use distinct NCT identifiers within each exact group. A changed source record can place the same study in multiple status, type or phase-combination groups.',
   'Condition, intervention-type and result-section memberships can overlap; a study is counted once within each exact source label.',
   'Names and conditions retain the source spelling. No synonym, sponsor-family or clinical-equivalence normalization is applied.',
   'The hasResults flag, registered protocol outcomes and retained posted-result sections are separate source fields.',
   'Dates keep their source precision and ACTUAL/ESTIMATED labels. Enrollment is kept as exact text at record level; no unique-participant total is inferred.',
   'Counts describe this selected capture and any explicit local filters. They do not estimate registry-wide prevalence, efficacy or patient eligibility.'
  ]};
}
const FILTER_KEYS=['statuses','studyTypes','phaseKeys','conditions','sponsors','resultsFlags','hasResultsSections','query'];
export function filterClinicalTrialsCohort(analysis,criteria={}){
 full(analysis);
 requireValue(analysis?.schema===ANALYSIS&&analysis.filters===null&&object(criteria)&&
  Object.keys(criteria).every(key=>FILTER_KEYS.includes(key)),'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');
 const filters={};
 for(const key of ['statuses','studyTypes','phaseKeys','conditions','sponsors']){
  const value=criteria[key]??[];
  requireValue(Array.isArray(value)&&value.length<=200&&value.every(item=>item===null||typeof item==='string'&&item.length<=4000),
   'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');
  filters[key]=[...new Set(value)].sort((a,b)=>compareText(JSON.stringify(a),JSON.stringify(b)));
 }
 const flags=criteria.resultsFlags??[];
 requireValue(Array.isArray(flags)&&flags.length<=3&&flags.every(value=>value===null||typeof value==='boolean'),
  'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');
 filters.resultsFlags=[...new Set(flags)].sort((a,b)=>compareText(JSON.stringify(a),JSON.stringify(b)));
 filters.hasResultsSections=criteria.hasResultsSections??null;
 requireValue(filters.hasResultsSections===null||typeof filters.hasResultsSections==='boolean',
  'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');
 filters.query=criteria.query??'';
 requireValue(typeof filters.query==='string'&&filters.query.length<=2000,'CLINICALTRIALS_ANALYSIS_FILTER_INVALID');
 filters.query=filters.query.trim();
 const query=filters.query.toLowerCase(),match=(list,value)=>list.length===0||list.includes(value);
 const rows=analysis.rows.filter(row=>match(filters.statuses,row.status)&&match(filters.studyTypes,row.studyType)&&
  match(filters.phaseKeys,row.phaseKey)&&match(filters.sponsors,row.sponsorName)&&match(filters.resultsFlags,row.hasResults)&&
  (filters.conditions.length===0||row.conditions.some(value=>filters.conditions.includes(value))||
   filters.conditions.includes(null)&&row.conditions.length===0)&&
  (filters.hasResultsSections===null||(row.resultsSections.length>0)===filters.hasResultsSections)&&
  (!query||[row.nctId,row.title,row.officialTitle??'',row.sponsorName??'',...row.conditions]
    .some(value=>value.toLowerCase().includes(query))));
 const groups=summaries(rows),repeated=repeatedStudies(rows),count=studyCount(rows);
 return {...analysis,filters,selectedStudies:count,selectedOccurrences:rows.length,excludedStudies:analysis.source.captureStudies-count,
  excludedOccurrences:analysis.source.captureOccurrences-rows.length,rows,repeatedStudies:repeated,groups,observations:overview(rows,groups,repeated)};
}
export function clinicalTrialsAnalysisPage(analysis,{offset=0,limit=50}={}){
 full(analysis);
 requireValue(analysis?.schema===ANALYSIS&&Number.isSafeInteger(offset)&&offset>=0&&
  Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'CLINICALTRIALS_ANALYSIS_PAGE_INVALID');
 return {...analysis,rows:analysis.rows.slice(offset,offset+limit),page:{offset,limit,total:analysis.rows.length}};
}
function full(analysis){
 requireValue(analysis?.schema===ANALYSIS&&Array.isArray(analysis.rows)&&
  analysis.rows.length===analysis.selectedOccurrences&&!analysis.page,'CLINICALTRIALS_ANALYSIS_COMPLETE_ROWS_REQUIRED');
}
function csvCell(value){
 let result=value===null||value===undefined?'':String(value);
 if(/^[\t\r\n ]*[=+\-@]/.test(result))result="'"+result;
 return '"'+result.replace(/"/g,'""')+'"';
}
export function renderClinicalTrialsCohortCsv(analysis){
 full(analysis);
 const headers=['nct_id','occurrence_id','title','official_title','status','study_type','phases_json','conditions_json',
  'lead_sponsor','sponsor_json','has_results','result_sections_json','enrollment_json','dates_json',
  'interventions_json','primary_outcomes_json','study_url','capture_id','page_index','page_study_index',
  'original_record_sha256','original_record_bytes','original_page_sha256','retained_edition_sha256'];
 const rows=analysis.rows.map(row=>[row.nctId,row.occurrenceId,row.title,row.officialTitle,row.status,row.studyType,
  JSON.stringify(row.phases),JSON.stringify(row.conditions),row.sponsorName,JSON.stringify(row.sponsor),
  row.hasResults===null?'':String(row.hasResults),JSON.stringify(row.resultsSections),JSON.stringify(row.enrollment),
  JSON.stringify(row.dates),JSON.stringify(row.interventions),JSON.stringify(row.primaryOutcomes),
  row.url,row.source.captureId,row.source.pageIndex,row.source.pageStudyIndex,row.source.recordSha256,
  row.source.recordBytes,row.source.pageSha256,analysis.source.editionSha256]);
 return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function renderClinicalTrialsCohortJson(analysis){
 full(analysis);return JSON.stringify(analysis,null,2)+'\n';
}
function tableRows(groups,format){
 if(format==='md')return ['| Source label | Studies | Share of selected studies |','| --- | ---: | ---: |',
  ...groups.map(row=>'| '+markdown(row.label)+' | '+row.count+' | '+row.percent+'% |')].join('\n');
 return '<div class="table"><table><thead><tr><th scope="col">Source label</th><th scope="col">Studies</th>'+
  '<th scope="col">Share of selected studies</th></tr></thead><tbody>'+
  groups.map(row=>'<tr><th scope="row">'+html(row.label)+'</th><td>'+row.count+'</td><td>'+row.percent+'%</td></tr>').join('')+
  '</tbody></table></div>';
}
const REPORT_GROUPS=[['Study status','statuses'],['Study type','studyTypes'],['Phase combinations','phaseCombinations'],
 ['Condition memberships','conditions'],['Lead sponsors','sponsors'],['Intervention-type memberships','interventionTypes'],
 ['Reported results flag','resultsFlags'],['Retained result-section memberships','resultsSections'],
 ['Results flag and section coverage','resultsCoverage'],['Enrollment type','enrollmentTypes']];
export function renderClinicalTrialsCohortReport(analysis,{format='html'}={}){
 full(analysis);requireValue(format==='html'||format==='md','CLINICALTRIALS_ANALYSIS_REPORT_FORMAT_INVALID');
 const coverage=analysis.source.complete?'Complete retained capture':'Partial retained capture';
 const intro=analysis.selectedStudies+' distinct selected studies in '+analysis.selectedOccurrences+' selected records from '+
  analysis.source.captureStudies+' retained studies and '+analysis.source.captureOccurrences+' source records. '+coverage+'.';
 const source={...analysis.source,sourcePages:analysis.source.sourcePages.map(row=>({
  index:row.index,url:row.url,sha256:row.sha256,rowCount:row.rowCount,receivedAt:row.receivedAt})),filters:analysis.filters,selectedRepeatedStudies:analysis.repeatedStudies};
 if(format==='md'){
  const parts=['# Trial registry cohort review','',markdown(analysis.label),'',markdown(analysis.question),'',intro,'',
   '## Findings from this source','',...analysis.observations.map(value=>'- '+markdown(value)),'','## Grouped review',''];
  for(const [label,key]of REPORT_GROUPS)parts.push('### '+label,'',tableRows(analysis.groups[key],'md'),'');
  parts.push('## Study inventory','','| NCT ID | Source position | Title | Status | Phase combination | Enrollment | Results flag |',
   '| --- | --- | --- | --- | --- | --- | --- |');
  for(const row of analysis.rows)parts.push('| ['+row.nctId+']('+row.url+') | Page '+(row.source.pageIndex+1)+', row '+(row.source.pageStudyIndex+1)+' | '+markdown(row.title)+' | '+markdown(row.status)+
   ' | '+markdown(row.phaseCombination.length?row.phaseCombination.join(' + '):null)+' | '+
   markdown(row.enrollment.count===null?null:row.enrollment.count+' ('+display(row.enrollment.type)+')')+' | '+
   markdown(row.hasResults===null?null:String(row.hasResults))+' |');
  parts.push('','## Method and source scope','',...analysis.methods.map(value=>'- '+markdown(value)),
   '','Full source fields and each record/page identity are in the cohort CSV and JSON. Registry links open the current public entry; the packet retains the exact reviewed edition.',
   '','## Retained source and filters','','~~~json',JSON.stringify(source,null,2),'~~~','');
  return parts.join('\n');
 }
 const sections=REPORT_GROUPS.map(([label,key])=>'<section><h2>'+html(label)+'</h2>'+
  tableRows(analysis.groups[key],'html')+'</section>').join('');
 const inventory='<div class="table"><table><thead><tr><th>NCT ID</th><th>Source position</th><th>Title</th><th>Status</th><th>Phase combination</th>'+
  '<th>Enrollment</th><th>Results flag</th></tr></thead><tbody>'+
  analysis.rows.map(row=>'<tr><th scope="row"><a href="'+row.url+'">'+row.nctId+'</a></th><td>Page '+(row.source.pageIndex+1)+', row '+(row.source.pageStudyIndex+1)+'</td><td>'+html(row.title)+
   '</td><td>'+html(row.status)+'</td><td>'+html(row.phaseCombination.length?row.phaseCombination.join(' + '):null)+
   '</td><td>'+html(row.enrollment.count===null?null:row.enrollment.count+' ('+display(row.enrollment.type)+')')+
   '</td><td>'+html(row.hasResults===null?null:String(row.hasResults))+'</td></tr>').join('')+'</tbody></table></div>';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Trial registry cohort review</title><style>'+
  ':root{font-family:Arial,Helvetica,sans-serif;color:#202020;background:#fff}*{box-sizing:border-box}body{margin:0;padding:24px}'+
  'main{max-width:1120px;margin:auto;min-width:0}h1{font-size:28px}h2{font-size:20px;margin-top:28px}p,li{line-height:1.55}'+
  'a{color:inherit;text-decoration:underline}header{border-bottom:2px solid #444;padding-bottom:16px}'+
  '.scope{font-weight:600}.table{overflow-x:auto;max-width:100%;border:1px solid #ccc}table{border-collapse:collapse;width:100%;font-size:14px}'+
  'th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}thead{background:#eee}'+
  'th:first-child{min-width:130px}td:nth-child(2){min-width:160px}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ccc;padding:14px}'+
  'details{margin:20px 0}summary{cursor:pointer;font-weight:600}footer{border-top:1px solid #ccc;margin-top:28px;padding-top:12px}'+
  '@media(max-width:600px){body{padding:14px}h1{font-size:24px}th,td{padding:8px}}'+
  '@media print{body{padding:0}.table{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}a{color:#000}}'+
  '</style></head><body><main><header><h1>Trial registry cohort review</h1><p>'+html(analysis.label)+
  '</p><p>'+html(analysis.question)+'</p><p class="scope">'+html(intro)+'</p></header><section><h2>Findings from this source</h2><ul>'+
  analysis.observations.map(value=>'<li>'+html(value)+'</li>').join('')+'</ul></section>'+sections+
  '<section><h2>Study inventory</h2>'+inventory+'</section><section><h2>Method and source scope</h2><ul>'+
  analysis.methods.map(value=>'<li>'+html(value)+'</li>').join('')+'</ul><p>Full source fields and each record/page identity are in the cohort CSV and JSON. '+
  'Registry links open the current public entry; the packet retains the exact reviewed edition.</p></section>'+
  '<details><summary>Retained source and filters</summary><pre>'+html(JSON.stringify(source,null,2))+'</pre></details>'+
  '<footer>Descriptive review of the selected retained registry source.</footer></main></body></html>';
}
