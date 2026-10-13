import {createProject,addDocument,addEdition,replaceMapping,freezeReview,selectedEdition,selectedReview,reviewIsCurrent,importProject,sha256} from './source-table-workspace.mjs';
import {validateSourceIntakes} from './adapters.mjs';
export const SCHEMA='tjlabs.heritage-training-research.v1';
export const HEADERS=Object.freeze({
 sources:['id','label','url','publisher','publication_date','retrieved_at','version','effective_from','effective_to','coverage','licence','notes'],
 providers:['id','ukprn','name','provider_type','nation','origin_intake_id','source_ids'],
 sites:['id','provider_id','name','postcode','location_basis','geography_code','origin_intake_id','source_ids'],
 qualifications:['id','authority','identifier','title','level','genre','origin_intake_id','source_ids'],
 qualification_versions:['id','qualification_id','version','effective_from','effective_to','status','origin_intake_id','source_ids'],
 occupations:['id','authority','identifier','title','standard_qualification_id','scope','origin_intake_id','source_ids'],
 content_components:['id','qualification_id','identifier','title','requirement','credits','origin_intake_id','source_ids'],
 identity_mappings:['id','from_table','from_id','from_namespace','from_identifier','to_namespace','to_identifier','relationship','effective_version_ids','origin_intake_id','source_ids'],
 offerings:['id','provider_id','site_id','qualification_version_id','standard_code','standard_version','occupation_option','start_date','end_date','delivery_mode','status','origin_intake_id','source_ids'],
 funding:['id','target_table','target_id','scheme','funding_year','eligibility_from','eligibility_to','category','amount','unit','status','origin_intake_id','source_ids'],
 measures:['id','provider_id','site_id','qualification_id','metric','population','cohort','period','geography','unit','denominator_basis','release_basis','suppression_basis','geography_basis','coverage_start','coverage_end','dimension_basis','original_token','value_status','exact_value','rounding_base','source_ids','aggregation_group','partition_key','origin_intake_id'],
 coverage:['id','source_id','population','period','geography','grain','inclusions','exclusions','missingness','completeness','assessed_by','assessed_at','origin_intake_id'],
 reviews:['id','topic','target_table','target_id','decision','actor','reviewed_at','rationale','material_json','material_sha256'],
 runs:['id','label','actor','created_at','definition_json','snapshot_json','snapshot_sha256','result_json','result_sha256']
});
export const DATA_TABLES=Object.freeze(Object.keys(HEADERS).filter(x=>!['reviews','runs'].includes(x)));
export const METRIC_FIELDS=Object.freeze(['metric','population','cohort','period','geography','unit','denominator_basis','release_basis','suppression_basis','geography_basis','coverage_start','coverage_end','dimension_basis','rounding_base']);
const copy=x=>JSON.parse(JSON.stringify(x)),fail=m=>{throw Error(m);};
export const stable=x=>JSON.stringify(x&&typeof x==='object'?(Array.isArray(x)?x.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(stable(x[k]))]))):x);
export function csv(headers,rows){return [headers,...rows.map(r=>headers.map(h=>r[h]??''))].map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';}
export function documentFor(project,resource){const d=project.documents.find(x=>x.resourceId===resource);if(!d)fail('Missing research table: '+resource);return d;}
function validateMapped(resource,data){if(stable(data.fields.map(f=>f.name))!==stable(HEADERS[resource]))fail('The selected '+resource+' columns differ from the complete intake contract.');const seen=new Set();for(const x of data.rows){if(typeof x.id!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(x.id)||seen.has(x.id))fail('Blank, malformed or repeated record identity in '+resource);seen.add(x.id);for(const key of HEADERS[resource])if(typeof x[key]!=='string')fail(resource+'.'+key+' must preserve an explicit text value.');}return data.rows;}
export function rows(project,resource){const d=documentFor(project,resource);if(!reviewIsCurrent(d))fail('Freeze the current source mapping for '+resource+' first.');return validateMapped(resource,JSON.parse(selectedReview(d).dataText));}
function text(v,n,max=20000){if(typeof v!=='string'||!v.trim()||v.length>max)fail(n+' is required, up to '+max+' characters.');return v;}
function date(v,n,optional=true){if(!v&&optional)return;if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail(n+' needs an actual ISO calendar date.');}
function interval(a,b,n){date(a,n+' start');date(b,n+' end');if(a&&b&&b<a)fail(n+' ends before it starts.');}
function ids(v){return v.split(';').map(s=>s.trim()).filter(Boolean);}
function tableMap(project){return Object.fromEntries(Object.keys(HEADERS).map(t=>[t,rows(project,t)]));}
function rowBy(tables,t,id,optional=false){if(!id&&optional)return null;const found=tables[t]?.find(r=>r.id===id);if(!found)fail('Unresolved '+t+' record: '+id);return found;}
function refs(tables,row){if(!Object.hasOwn(row,'source_ids'))return;const list=ids(row.source_ids);if(!list.length||new Set(list).size!==list.length)fail(row.id+' needs distinct source IDs.');for(const id of list)rowBy(tables,'sources',id);}
export function validateData(project){return validateTables(tableMap(project));}
function validateTables(t){
 for(const name of DATA_TABLES)for(const r of t[name])refs(t,r);
 for(const r of t.sources){text(r.label,'Source label');text(r.publisher,'Source publisher');const u=/^(https?):\/\/([^/?#]+)(?:[/?#][^\s]*)?$/.exec(r.url);if(!u||u[2].includes('@')||/[\s\\]/.test(r.url))fail('Use the actual public or authorized source URL.');date(r.publication_date,'Publication date');date(r.retrieved_at,'Retrieval date');interval(r.effective_from,r.effective_to,'Source applicability');}
 const unique=(items,key,label)=>{const seen=new Set();for(const r of items){const k=key(r);if(!k)continue;if(seen.has(k))fail('Duplicate '+label+' identity; use the existing record and its actual source mapping.');seen.add(k);}};
 unique(t.providers,r=>r.ukprn,'UKPRN');unique(t.qualifications,r=>r.authority+'|'+r.identifier,'qualification authority/identifier');unique(t.qualification_versions,r=>r.qualification_id+'|'+r.version,'qualification version');unique(t.occupations,r=>r.authority+'|'+r.identifier,'occupation');
 for(const r of t.providers){text(r.name,'Provider name');if(r.ukprn&&!/^\d{8}$/.test(r.ukprn))fail('UKPRN is the original eight-digit provider identifier.');}
 for(const r of t.sites){rowBy(t,'providers',r.provider_id);text(r.location_basis,'Site location basis');}
 for(const r of t.qualifications){for(const k of ['authority','identifier','title','genre'])text(r[k],k);}
 for(const r of t.qualification_versions){rowBy(t,'qualifications',r.qualification_id);text(r.version,'Qualification or standard version');interval(r.effective_from,r.effective_to,'Qualification version');text(r.status,'Original version status');}
 for(const r of t.occupations){rowBy(t,'qualifications',r.standard_qualification_id);for(const k of ['authority','identifier','title','scope'])text(r[k],k);}
 for(const r of t.content_components){rowBy(t,'qualifications',r.qualification_id);for(const k of ['identifier','title','requirement'])text(r[k],k);if(r.credits&&!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(r.credits))fail('Credits retain an explicit nonnegative decimal.');}
 for(const r of t.identity_mappings){if(!['qualifications','qualification_versions','occupations','providers','sites'].includes(r.from_table))fail('Choose an explicit identity-mapping source table.');rowBy(t,r.from_table,r.from_id);for(const k of ['from_namespace','from_identifier','to_namespace','to_identifier','relationship'])text(r[k],k);for(const id of ids(r.effective_version_ids))rowBy(t,'qualification_versions',id);}
 for(const r of t.offerings){rowBy(t,'providers',r.provider_id);const s=rowBy(t,'sites',r.site_id,true);if(s&&s.provider_id!==r.provider_id)fail('The selected site belongs to a different provider.');rowBy(t,'qualification_versions',r.qualification_version_id,true);if(!r.qualification_version_id&&!r.standard_code)fail('An offering needs its qualification version or actual apprenticeship standard.');interval(r.start_date,r.end_date,'Offering');text(r.status,'Offering status');}
 for(const r of t.funding){if(!['qualifications','qualification_versions','offerings','providers'].includes(r.target_table))fail('Choose a supported funding target.');rowBy(t,r.target_table,r.target_id);interval(r.eligibility_from,r.eligibility_to,'Funding eligibility');if(r.amount&&!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(r.amount))fail('Funding amount uses an ordinary nonnegative decimal string.');if(r.amount)text(r.unit,'Funding currency/unit');}
 for(const r of t.measures){
 rowBy(t,'providers',r.provider_id,true);const s=rowBy(t,'sites',r.site_id,true);if(s&&(!r.provider_id||s.provider_id!==r.provider_id))fail('A measure site requires its actual linked provider.');rowBy(t,'qualifications',r.qualification_id,true);
 for(const key of ['metric','population','cohort','period','geography','unit','denominator_basis','release_basis','suppression_basis','geography_basis','dimension_basis','value_status'])text(r[key],key);
 if(typeof r.original_token!=='string'||r.original_token.length>20000)fail('Retain the original source token as a string, including an explicitly empty cell.');
 interval(r.coverage_start,r.coverage_end,'Measure coverage');
 if(!['exact','rounded','zero','suppressed','not_available','not_applicable','not_collected'].includes(r.value_status))fail('Choose the source-defined value status.');
 if(['exact','rounded','zero'].includes(r.value_status)){if(!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(r.exact_value))fail('A published numeric measure requires its original nonnegative numeric value.');if(r.value_status==='zero'&&Number(r.exact_value)!==0)fail('True zero must be numeric zero.');}
 else if(r.exact_value)fail('Suppressed, missing or inapplicable observations must not acquire a numeric replacement.');
 if(r.value_status==='rounded'){if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(r.rounding_base)||!/[1-9]/.test(r.rounding_base))fail('Retain the stated positive decimal rounding quantum.');}else if(r.rounding_base&&r.rounding_base!=='0')fail('An unrounded value does not carry a rounding base.');
 if(Boolean(r.aggregation_group)!==Boolean(r.partition_key))fail('Aggregation group and nonoverlapping partition key must be recorded together.');
 }
 for(const r of t.coverage){rowBy(t,'sources',r.source_id);for(const k of ['population','period','geography','grain','inclusions','exclusions','missingness','completeness'])text(r[k],k);}
 return t;
}
async function write(project,table,items){
 const d=documentFor(project,table),n=(await addEdition(project,d.id,{filename:selectedEdition(d).filename,sourceText:csv(HEADERS[table],items)})).project;
 return (await freezeReview(n,d.id)).project;
}
export async function createResearchProject(seed={}){
 let p=createProject({name:'Heritage training provision and qualification research'});
 for(const [name,headers] of Object.entries(HEADERS)){
 const a=await addDocument(p,{resourceId:name,filename:name+'.csv',sourceText:csv(headers,seed[name]||[]),delimiter:',',header:true,skipEmptyRecords:false});p=a.project;
 const d=documentFor(p,name),mapping=copy(d.mapping);mapping.columns=mapping.columns.map(c=>({...c,type:'text',empty:'keep',trim:false}));mapping.keyColumns=[0];p=replaceMapping(p,d.id,mapping);p=(await freezeReview(p,d.id)).project;
 }
 return receiveResearch(p);
}
export async function upsert(project,table,input){
 if(!DATA_TABLES.includes(table))fail('Review and run histories use their explicit append operations.');
 const p=await receiveResearch(project),r=Object.fromEntries(HEADERS[table].map(k=>[k,String(input[k]??'')])),current=rows(p,table),i=current.findIndex(x=>x.id===r.id);
 if(i<0)current.push(r);else{if(current[i].origin_intake_id&&stable(current[i])!==stable(r))r.origin_intake_id='';current[i]=r;}
 const next=await write(p,table,current);validateData(next);return receiveResearch(next);
}
export async function receiveTableEdition(project,table,filename,sourceText){
 if(!DATA_TABLES.includes(table))fail('Import data tables; review/run history remains append-only through this application.');
 const p=await receiveResearch(project),d=documentFor(p,table),next=(await addEdition(p,d.id,{filename,sourceText})).project;
 const mapping=copy(documentFor(next,table).mapping);mapping.columns=mapping.columns.map(c=>({...c,type:'text',empty:'keep',trim:false}));
 const frozen=(await freezeReview(replaceMapping(next,d.id,mapping),d.id)).project;
 validateData(frozen);return receiveResearch(frozen);
}
function binding(project,table,reviewId){
 const d=documentFor(project,table),r=d.reviews.find(x=>x.id===(reviewId||d.selectedReviewId));if(!r)fail('Original retained review is absent: '+table);
 return {table,documentId:d.id,reviewId:r.id,editionId:r.editionId,sourceSha256:r.sourceSha256,outputSha256:r.outputSha256};
}
function material(tables,table,id){
 const collected=new Map();
 function include(t,i){const key=t+':'+i;if(collected.has(key))return;const r=rowBy(tables,t,i);collected.set(key,{table:t,row:copy(r)});
 if(r.source_ids)for(const source of ids(r.source_ids))include('sources',source);
 if(t==='sites')include('providers',r.provider_id);
 if(t==='qualification_versions')include('qualifications',r.qualification_id);
 if(t==='offerings'){include('providers',r.provider_id);if(r.site_id)include('sites',r.site_id);if(r.qualification_version_id)include('qualification_versions',r.qualification_version_id);}
 if(t==='funding')include(r.target_table,r.target_id);
 if(t==='occupations')include('qualifications',r.standard_qualification_id);
 if(t==='content_components')include('qualifications',r.qualification_id);
 if(t==='identity_mappings'){include(r.from_table,r.from_id);for(const v of ids(r.effective_version_ids))include('qualification_versions',v);}
 if(t==='coverage')include('sources',r.source_id);
 if(t==='measures'){if(r.provider_id)include('providers',r.provider_id);if(r.site_id)include('sites',r.site_id);if(r.qualification_id)include('qualifications',r.qualification_id);}
 }
 include(table,id);return [...collected.values()].sort((a,b)=>(a.table+':'+a.row.id).localeCompare(b.table+':'+b.row.id));
}
export async function recordReview(project,input){
 const p=await receiveResearch(project),t=validateData(p);
 if(!DATA_TABLES.includes(input.target_table))fail('Choose a research data target.');
 for(const k of ['topic','decision','actor','rationale'])text(input[k],k);
 const refs=DATA_TABLES.map(name=>binding(p,name)),m=material(t,input.target_table,input.target_id),mjson=stable({refs,records:m});
 const r={id:'review-'+crypto.randomUUID(),topic:input.topic,target_table:input.target_table,target_id:input.target_id,decision:input.decision,actor:input.actor,reviewed_at:new Date().toISOString(),rationale:input.rationale,material_json:mjson,material_sha256:await sha256(mjson)};
 return write(p,'reviews',[...t.reviews,r]);
}
function historicalTables(project,refs){
 if(!Array.isArray(refs)||refs.length!==DATA_TABLES.length||new Set(refs.map(x=>x.table)).size!==refs.length)fail('Historical input binding is incomplete.');
 const t={};for(const ref of refs){if(!DATA_TABLES.includes(ref.table)||stable(binding(project,ref.table,ref.reviewId))!==stable(ref))fail('Historical source identity differs.');const d=documentFor(project,ref.table),r=d.reviews.find(x=>x.id===ref.reviewId);t[ref.table]=validateMapped(ref.table,JSON.parse(r.dataText));}
 return validateTables(t);
}
export async function reviewStatuses(project){
 const t=validateData(project),out=[];
 for(const r of t.reviews){if(!DATA_TABLES.includes(r.target_table))fail('Review target table is invalid.');const m=JSON.parse(r.material_json);if(await sha256(r.material_json)!==r.material_sha256||stable(m)!==r.material_json)fail('A saved research review has changed.');const historical=historicalTables(project,m.refs);if(stable(material(historical,r.target_table,r.target_id))!==stable(m.records))fail('Saved research review does not match its historical target/source closure.');let current=false;try{current=stable(material(t,r.target_table,r.target_id))===stable(m.records);}catch{}out.push({...r,current,status:current?'current':'needs_review'});}
 return out;
}
function roundedSum(values){let scale=0;for(const v of values)scale=Math.max(scale,(v.split('.')[1]||'').length);let n=0n;for(const v of values){const [a,b='']=v.split('.');n+=BigInt(a+b.padEnd(scale,'0'));}const s=n.toString().padStart(scale+1,'0');return scale?s.slice(0,-scale)+'.'+s.slice(-scale):s;}
export function analyzeTables(t,definition){
 const selected=definition.measure_ids||[];if(!Array.isArray(selected)||new Set(selected).size!==selected.length)fail('Choose distinct explicit measure IDs.');
 const measures=selected.map(id=>rowBy(t,'measures',id)),issues=[],groups={};
 for(const r of measures){const key=stable(Object.fromEntries(METRIC_FIELDS.map(k=>[k,r[k]])));(groups[key]||=[]).push(r);}
 const aggregations=[];
 for(const [key,items] of Object.entries(groups)){
 const basis=JSON.parse(key),numeric=items.every(r=>['exact','rounded','zero'].includes(r.value_status)),sameGroup=items.length===1||(items.every(r=>r.aggregation_group&&r.aggregation_group===items[0].aggregation_group)&&new Set(items.map(r=>r.partition_key)).size===items.length);
 const additive=items.length===1||['people','learners','certificates','starts','achievements','enrolments','records','aims','programme aims'].includes(basis.unit.toLowerCase());const allowed=numeric&&sameGroup&&additive;
 aggregations.push({basis,measureIds:items.map(r=>r.id),status:allowed?'reported_value_sum':'unaggregated',reportedValue:allowed?roundedSum(items.map(r=>r.exact_value)):null,meaning:allowed?(items.length===1?(items[0].value_status==='rounded'?'Published rounded observation, retained at its original unit and rounding quantum.':'Published observation, retained at its original unit and denominator basis.'):(items.some(r=>r.value_status==='rounded')?'Sum of published rounded values; not an exact learner total.':'Sum of explicitly selected comparable published values.')):'Retained separately: suppression/missingness or a nonadditive unit or missing explicit nonoverlapping partition declaration.',observations:copy(items)});
 if(!allowed)issues.push({kind:'unaggregated_measures',ids:items.map(r=>r.id),reason:!numeric?'Source includes suppressed, missing or inapplicable values.':!additive?'Rates, percentages and other nonadditive units remain separate.':'Explicit nonoverlapping partition declaration is absent or duplicated.'});
 }
 const asOf=definition.as_of||'';date(asOf,'Analysis as-of date',false);
 const offerings=t.offerings.map(o=>({...copy(o),asOfStatus:o.start_date&&o.start_date>asOf?'future':o.end_date&&o.end_date<asOf?'ended':!o.start_date?'undated':'within_recorded_dates'}));
 for(const o of offerings)if(!o.site_id)issues.push({kind:'offering_site_unresolved',ids:[o.id],reason:'Provider identity does not identify a delivery location.'});
 for(const c of t.coverage)if(c.completeness!=='complete')issues.push({kind:'coverage_limit',ids:[c.id],reason:c.missingness+'; '+c.exclusions});
 return {asOf,counts:{sources:t.sources.length,providers:t.providers.length,sites:t.sites.length,qualifications:t.qualifications.length,qualificationVersions:t.qualification_versions.length,offerings:t.offerings.length,measures:t.measures.length},offerings,aggregations,issues,coverage:copy(t.coverage),method:'Source-defined metrics stay separate. No automatic completion rate or population extrapolation is calculated. Recorded dates and source coverage govern interpretation.'};
}
export async function saveAnalysis(project,input){
 const p=await receiveResearch(project),t=validateData(p);text(input.label,'Analysis label');text(input.actor,'Analyst');
 const definition={as_of:input.as_of,measure_ids:input.measure_ids||[]},statuses=await reviewStatuses(p),result=analyzeTables(t,definition);
 result.researchReviews=statuses.map(r=>({id:r.id,topic:r.topic,targetTable:r.target_table,targetId:r.target_id,decision:r.decision,status:r.status,actor:r.actor,rationale:r.rationale,materialSha256:r.material_sha256}));
 const snapshot={schema:SCHEMA,refs:DATA_TABLES.map(name=>binding(p,name)),tables:Object.fromEntries(DATA_TABLES.map(k=>[k,t[k]])),researchReviewIds:t.reviews.map(r=>r.id),researchReviews:{binding:binding(p,'reviews'),rows:t.reviews}},snap=stable(snapshot),out=stable(result);
 const r={id:'run-'+crypto.randomUUID(),label:input.label,actor:input.actor,created_at:new Date().toISOString(),definition_json:stable(definition),snapshot_json:snap,snapshot_sha256:await sha256(snap),result_json:out,result_sha256:await sha256(out)};
 return write(p,'runs',[...t.runs,r]);
}
function validateAppendHistory(project,table){
 const d=documentFor(project,table),current=new Map(rows(project,table).map(r=>[r.id,stable(r)])),seen=new Map();
 for(const review of d.reviews){for(const r of JSON.parse(review.dataText).rows){const body=stable(r);if(seen.has(r.id)&&seen.get(r.id)!==body)fail('Historical '+table+' identity was rewritten: '+r.id);seen.set(r.id,body);if(current.get(r.id)!==body)fail('Current '+table+' must retain every original immutable history record.');}}
}
export async function receiveResearch(input){
 const p=await importProject(input);if(p.documents.length!==Object.keys(HEADERS).length||p.documents.some(d=>!Object.hasOwn(HEADERS,d.resourceId)))fail('Receive the complete training research project with every declared table.');
 const t=validateData(p);validateAppendHistory(p,'reviews');validateAppendHistory(p,'runs');await reviewStatuses(p);
 for(const r of t.runs){const snapshot=JSON.parse(r.snapshot_json),result=JSON.parse(r.result_json),def=JSON.parse(r.definition_json);
 if(snapshot.schema!==SCHEMA||await sha256(r.snapshot_json)!==r.snapshot_sha256||await sha256(r.result_json)!==r.result_sha256||stable(snapshot)!==r.snapshot_json||stable(result)!==r.result_json||stable(def)!==r.definition_json)fail('A saved research analysis identity differs.');
 const historical=historicalTables(p,snapshot.refs);if(stable(historical)!==stable(snapshot.tables))fail('The saved analysis source rows differ from their original retained reviews.');
 const rb=snapshot.researchReviews?.binding;if(!rb||rb.table!=='reviews'||stable(binding(p,'reviews',rb.reviewId))!==stable(rb))fail('The original complete research review selection is absent.');const rd=documentFor(p,'reviews'),rr=rd.reviews.find(x=>x.id===rb.reviewId),relevant=validateMapped('reviews',JSON.parse(rr.dataText));if(stable(relevant)!==stable(snapshot.researchReviews.rows)||stable(relevant.map(x=>x.id))!==stable(snapshot.researchReviewIds))fail('The analysis must retain its whole original ordered research review roster.');
 const rederived=analyzeTables(historical,def);rederived.researchReviews=[];
 for(const v of relevant){const m=JSON.parse(v.material_json);let current=false;try{current=stable(material(historical,v.target_table,v.target_id))===stable(m.records);}catch{}rederived.researchReviews.push({id:v.id,topic:v.topic,targetTable:v.target_table,targetId:v.target_id,decision:v.decision,status:current?'current':'needs_review',actor:v.actor,rationale:v.rationale,materialSha256:v.material_sha256});}
 if(stable(rederived)!==stable(result))fail('The saved analysis does not reproduce from its original source and review records.');
 }
 await validateSourceIntakes(p,{rows,documentFor,HEADERS,DATA_TABLES});return p;
}
export async function summary(project){const p=await receiveResearch(project),t=validateData(p),reviews=await reviewStatuses(p);return {projectId:p.id,tables:Object.entries(t).map(([id,items])=>({id,rows:items.length,editions:documentFor(p,id).editions.length})),researchReviews:reviews,analysisRuns:t.runs.map(r=>({id:r.id,label:r.label,createdAt:r.created_at,actor:r.actor})),coverage:t.coverage};}
export function escapeHtml(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function reportHtml(run){const result=JSON.parse(run.result_json),h=escapeHtml;return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+h(run.label)+'</title><style>body{font:16px/1.55 system-ui;max-width:1100px;margin:auto;padding:28px;color:#202020}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{border:1px solid #ccc;padding:10px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1,h2{line-height:1.2}@media print{body{padding:0}}</style><h1>'+h(run.label)+'</h1><p>Analyst '+h(run.actor)+' · '+h(run.created_at)+' · as of '+h(result.asOf)+'</p><p>'+h(result.method)+'</p><h2>Source selection</h2><p>Snapshot '+h(run.snapshot_sha256)+'</p><h2>Published measures</h2><table><thead><tr><th>Metric / population / cohort</th><th>Period and unit</th><th>Reported value</th><th>Interpretation</th></tr></thead><tbody>'+result.aggregations.map(a=>'<tr><td>'+h(a.basis.metric)+' / '+h(a.basis.population)+' / '+h(a.basis.cohort)+'</td><td>'+h(a.basis.period)+' · '+h(a.basis.unit)+'</td><td>'+h(a.reportedValue??'Retained separately')+'</td><td>'+h(a.meaning)+'</td></tr>').join('')+'</tbody></table><h2>Coverage and unresolved work</h2>'+result.issues.map(x=>'<p><strong>'+h(x.kind)+'</strong>: '+h(x.ids.join(', '))+' — '+h(x.reason)+'</p>').join('')+'<h2>Research decisions</h2>'+result.researchReviews.map(x=>'<p><strong>'+h(x.status)+' · '+h(x.topic)+'</strong> '+h(x.targetTable+':'+x.targetId)+' · '+h(x.decision)+'<br>'+h(x.rationale)+'</p>').join('')+'<h2>Complete saved result</h2><pre>'+h(JSON.stringify(result,null,2))+'</pre></html>';}
