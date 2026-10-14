/** Additive observed benchmark studies on the original Measurements SQLite owner. */
import {hash,stable,parseSource} from './normalise.mjs';
import {InputError,csv,SOURCE_LINE_EDITION,sourceLineEndings} from './parse.mjs';
import {cohortOf,validateDefinition,calculateBenchmark} from './benchmarks.mjs';
const STUDY='observed-benchmark-study',DRAFT='observed-benchmark-draft',REQUEST='observed-benchmark-request';
export const BENCHMARK_LIMITS={study_bytes:64*1024*1024,project_bytes:128*1024*1024-64*1024,draft_bytes:4*1024*1024,records:100000};
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,SHA=/^[a-f0-9]{64}$/;
const clone=x=>JSON.parse(JSON.stringify(x)),decode=x=>typeof x==='string'?JSON.parse(x):x;
function fail(m,status=400){throw new InputError(m,status);}
function bound(value,bytes,label){if(Buffer.byteLength(JSON.stringify(value))>bytes)fail(label+' exceeds its complete-file bound; narrow the study or retain its originals separately before selecting another edition',413);return value;}
function uid(value){if(!UUID.test(value))fail('Retain a valid original request or draft UUID');return value;}
function cohortId(row){return hash(stable(cohortOf(row)));}
function sourceValue(w,id){
 const raw=w.source(id);if(!['wqp','usgs-daily'].includes(raw.kind))fail('Choose an original measurement source');
 return {id:raw.id,kind:raw.kind,label:raw.label,created_at:raw.created_at,sha:raw.sha,content:raw.content,
  mapping:decode(raw.mapping),origin:decode(raw.origin),summary:decode(raw.summary),rejected:decode(raw.rejected)};
}
function sourceProjection(sources,selection){
 if(!Array.isArray(sources)||sources.length!==selection.source_ids.length||new Set(sources.map(x=>x.id)).size!==sources.length)fail('Retain each selected full original source exactly once');
 const rows=new Map(),selectedKeys=new Set(),sourceIDs=new Set(selection.source_ids),cohortStations=new Set();let cohort=null;
 for(const source of sources){
  if(!sourceIDs.has(source.id)||!['wqp','usgs-daily'].includes(source.kind)||typeof source.content!=='string'||hash(source.content)!==source.sha)fail('An original benchmark source differs from its declared bytes');
  const parsed=parseSource({kind:source.kind,text:source.content,mapping:source.mapping,lineEndings:sourceLineEndings(source.summary)});
  if(hash(stable([source.kind,source.sha,parsed.mapping]))!==source.id||stable(parsed.mapping)!==stable(source.mapping))fail('An original source mapping or identity differs');
  if(stable(parsed.rejected)!==stable(source.rejected))fail('Original rejected source rows were changed or omitted');
  const summary={rows:parsed.rows.length,rejectedCount:parsed.rejected.length,stationCount:new Set(parsed.rows.map(x=>x.row.stationId||x.row.id)).size,censored:parsed.rows.filter(x=>x.row.censor&&x.row.censor!=='none').length,parameters:{},issues:{}};if(parsed.kind!=='usgs-daily'&&parsed.lineEndings==='physical')summary.sourceLineEdition=SOURCE_LINE_EDITION;for(const {row}of parsed.rows){if(row.parameter)summary.parameters[row.parameter]=(summary.parameters[row.parameter]||0)+1;for(const issue of row.issues||[])summary.issues[issue]=(summary.issues[issue]||0)+1;}if(stable(summary)!==stable(source.summary))fail('Original source parse accounting differs');
  for(const p of source.origin?.pages||[])if(typeof p.text!=='string'||hash(p.text)!==p.sha)fail('An original provider page differs');
  for(const {line,row}of parsed.rows){
   const sameCohort=cohortId(row)===selection.cohort_id;if(sameCohort){cohort=cohortOf(row);cohortStations.add(row.stationId);}
   const matches=sameCohort&&selection.station_ids.includes(row.stationId)&&row.sampledDate>=selection.from&&row.sampledDate<=selection.to;
   if(matches)selectedKeys.add(row.logicalKey);
   const id=hash(stable([row.sourceKind,row]));
   if(!rows.has(id))rows.set(id,{...row,id,selection_match:matches,sourceReferences:[]});
   rows.get(id).sourceReferences.push({id:source.id,label:source.label,sha:source.sha,source_line:line});
  }
 }
 if(!cohort)fail('The selected cohort does not exist in these complete original sources');
 if(selection.station_ids.some(id=>!cohortStations.has(id)))fail('A selected station has no original observations in this exact cohort');
 const chosen=[...rows.values()].filter(row=>selectedKeys.has(row.logicalKey));
 if(chosen.length>BENCHMARK_LIMITS.records)fail('Select at most '+BENCHMARK_LIMITS.records+' distinct native observations',413);
 return {cohort,rows:chosen.map(row=>({...row,sourceReferences:row.sourceReferences.sort((a,b)=>a.id.localeCompare(b.id)||a.source_line-b.source_line)})).sort((a,b)=>a.sampledDate.localeCompare(b.sampledDate)||a.id.localeCompare(b.id))};
}
function sourceRows(sources,selection){return sourceProjection(sources,selection).rows;}
function checkedContext(value){
 if(!value||!SHA.test(value.id)||!['pending','include','exclude'].includes(value.review?.state))fail('Retain the original native review state');
 if(value.review.state!=='pending'&&(!value.review.reviewer||!value.review.reason))fail('Native included/excluded reviews need their original attribution');
 if(value.selectedVersion!==null&&!SHA.test(value.selectedVersion))fail('Retain the original selected version identity');
 return value;
}
export function rebuildBenchmark(input){
 bound(input,BENCHMARK_LIMITS.study_bytes,'Benchmark input');
 const definition=validateDefinition(input?.definition);
 if(!Number.isSafeInteger(input.workspace_revision)||input.workspace_revision<0)fail('Retain the original measured-input revision');
 const projection=sourceProjection(input.sources,definition.selection),rows=projection.rows,contexts=input.contexts;
 if(stable(input.cohort)!==stable(projection.cohort))fail('Retain the exact cohort quantity, unit, chemical basis and method from the selected original files');
 if(!Array.isArray(contexts)||contexts.length!==rows.length||new Set(contexts.map(x=>x.id)).size!==contexts.length)fail('Retain the complete native review context for every selected source row');
 const contextMap=new Map(contexts.map(x=>[x.id,checkedContext(x)]));
 for(const row of rows){const context=contextMap.get(row.id);if(!context)fail('Original source review context is missing');row.review=clone(context.review);row.selectedVersion=context.selectedVersion;}
 const normalized={definition,workspace_revision:input.workspace_revision,cohort:clone(projection.cohort),sources:clone(input.sources),contexts:clone(contexts)};
 const id=hash(stable(normalized));
 return bound({format:'upstate.observed-benchmark-study/v1',id,study_id:definition.study_id,parent_id:definition.parent_id,input:normalized,result:calculateBenchmark(rows,definition)},BENCHMARK_LIMITS.study_bytes,'Complete benchmark study');
}
function basisInput(w,definition){
 const basis=definition?.source_basis;if(!basis)return null;
 const value=basis.kind==='study'?getRow(w,basis.id,STUDY):getRow(w,draftKey(basis.id),DRAFT);
 if(!value)fail('The explicitly selected historical source basis is not retained here',404);
 const input=basis.kind==='study'?validateStudy(value).input:checkedDraft(value).source_snapshot;
 if(!input)fail('This unfinished draft has no valid captured source selection; choose current originals');
 return input;
}
function captureInput(w,definition,{allowIncomplete=false}={}){
 if(!allowIncomplete)definition=validateDefinition(definition);
 const s=definition?.selection;
 if(!s||!Array.isArray(s.source_ids)||!s.source_ids.length||!SHA.test(s.cohort_id)||!Array.isArray(s.station_ids)||typeof s.from!=='string'||typeof s.to!=='string')return null;
 const basis=basisInput(w,definition);
 const sources=s.source_ids.map(id=>{if(!basis)return sourceValue(w,id);const source=basis.sources.find(x=>x.id===id);if(!source)fail('The historical basis does not contain this selected original file');return clone(source);});
 const projection=sourceProjection(sources,s),rows=projection.rows,contextMap=basis?new Map(basis.contexts.map(c=>[c.id,c])):null;
 const contexts=rows.map(row=>{if(contextMap){const c=contextMap.get(row.id);if(!c)fail('The historical basis has no reviewed context for this observation; choose an original current-source basis for a broader selection');return clone(c);}
 const native=w.record(row.id);return{id:row.id,review:clone(native.review),selectedVersion:native.selectedVersion||null};});
 return {definition:clone(definition),workspace_revision:basis?basis.workspace_revision:w.revision(),cohort:clone(projection.cohort),sources,contexts};
}
function prepare(w,definition){
 definition=validateDefinition(definition);const input=captureInput(w,definition);
 return rebuildBenchmark(input);
}
export function previewBenchmark(w,body){return w.readConsistent(()=>prepare(w,body.definition));}
function getRow(w,id,kind){const row=w.db.prepare('SELECT * FROM exports WHERE id=? AND kind=?').get(id,kind);return row?JSON.parse(row.content):null;}
function exactExisting(w,id,kind,value){
 const row=w.db.prepare('SELECT kind,content FROM exports WHERE id=?').get(id);
 if(row&&(row.kind!==kind||stable(JSON.parse(row.content))!==stable(value)))fail('This immutable benchmark identity already contains different original content',409);
 return !!row;
}
function put(w,id,kind,value,at){if(exactExisting(w,id,kind,value))return false;w.db.prepare('INSERT INTO exports(id,created_at,revision,kind,content) VALUES(?,?,?,?,?)').run(id,at,w.revision(),kind,JSON.stringify(value));return true;}
function artifactAtomic(w,fn){w.db.exec('BEGIN IMMEDIATE');try{const result=fn();validateProject({format:'upstate.observed-benchmark-project/v1',studies:familyRows(w,STUDY),drafts:familyRows(w,DRAFT),requests:familyRows(w,REQUEST)});w.db.exec('COMMIT');return result;}catch(error){w.db.exec('ROLLBACK');throw error;}}
function requestKey(id){return 'observed-benchmark-request:'+uid(id);}
function receipt(w,body,action){
 const prior=getRow(w,requestKey(body.request_id),REQUEST);
 if(prior){if(prior.action!==action||prior.request_sha256!==hash(stable(body)))fail('This original request UUID belongs to different bytes or another operation',409);return prior;}
 return null;
}
function retainedRequest(w,body,action,result){
 const value={format:'upstate.observed-benchmark-request/v1',request_id:body.request_id,action,request_sha256:hash(stable(body)),body:action==='receive'?null:clone(body),result};
 put(w,requestKey(body.request_id),REQUEST,value,new Date().toISOString());return value;
}
export function benchmarkRequest(w,id){
 const value=getRow(w,requestKey(id),REQUEST);if(!value)fail('No accepted benchmark request with this UUID is retained',404);
 return {...value.result,action:value.action};
}
function validateStudy(study){if(study?.format!=='upstate.observed-benchmark-study/v1')fail('Choose a complete original benchmark study');const rebuilt=rebuildBenchmark(study.input);if(stable(rebuilt)!==stable(study))fail('The retained benchmark differs from its original sources, reviewed context or calculation');return rebuilt;}
export function readBenchmark(w,id){if(!SHA.test(id))fail('Invalid saved benchmark identity');const value=getRow(w,id,STUDY);if(!value)fail('Saved benchmark not found',404);return validateStudy(value);}
export function saveBenchmark(w,body){
 uid(body.request_id);return artifactAtomic(w,()=>{
  const old=receipt(w,body,'save');if(old)return old.result;
  const historical=basisInput(w,body.definition);
  if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision!==(historical?historical.workspace_revision:w.revision()))fail('Measured sources or reviews changed. Refresh and prepare the current source edition before saving a new request.',409);
  const study=prepare(w,body.definition);
  if(body.expected_preview_id!==study.id)fail('The complete source preview changed. Inspect the original input and rule again.',409);
  if(study.parent_id){const parent=readBenchmark(w,study.parent_id);if(parent.study_id!==study.study_id)fail('The previous edition belongs to another named study');}
  else if(w.db.prepare('SELECT content FROM exports WHERE kind=?').all(STUDY).some(row=>JSON.parse(row.content).study_id===study.study_id))fail('Select a saved parent when adding another edition to this named study',409);
  put(w,study.id,STUDY,study,study.input.definition.at);
  const result={request_id:body.request_id,request_sha256:hash(stable(body)),study_id:study.id,workspace_revision:w.revision()};
  retainedRequest(w,body,'save',result);w.event('observed-benchmark-study',study.id,{study_id:study.study_id,parent_id:study.parent_id,title:study.input.definition.title,actor:study.input.definition.actor,request_id:body.request_id});
  return result;
 });
}
export function abandonBenchmark(w,body){
 const original=body?.request;uid(original?.request_id);
 if(!body.actor?.trim()||!body.reason?.trim()||!Number.isFinite(Date.parse(body.at)))fail('Attribute the explicit retirement of this original save');
 validateDefinition(original.definition);
 if(!SHA.test(original.expected_preview_id)||!Number.isSafeInteger(original.expected_revision))fail('Retain the complete original save request');
 return artifactAtomic(w,()=>{
  const prior=receipt(w,original,'save');if(prior)return prior.result;
  const result={request_id:original.request_id,request_sha256:hash(stable(original)),abandoned:true,abandon:{actor:body.actor,at:body.at,reason:body.reason},workspace_revision:w.revision()};
  retainedRequest(w,original,'save',result);w.event('observed-benchmark-abandon',original.request_id,result.abandon);return result;
 });
}
function checkedDraft(draft){
 if(!draft||typeof draft!=='object'||Array.isArray(draft))fail('Choose a complete unfinished benchmark draft');
 uid(draft.id);for(const k of ['title','actor','at','raw_definition'])if(typeof draft[k]!=='string')fail('Retain draft '+k+' as exact text');
 if(!Number.isFinite(Date.parse(draft.at)))fail('Retain the working-copy time; blank unfinished attribution stays blank');
 if(draft.base_study_id!==null&&!SHA.test(draft.base_study_id))fail('Invalid original working basis');
 if(draft.structured_definition!==null&&(!draft.structured_definition||typeof draft.structured_definition!=='object'||Array.isArray(draft.structured_definition)))fail('Retain the last structured definition or null');
 if(draft.pending_request!==null){const p=draft.pending_request;uid(p.request_id);if(!SHA.test(p.expected_preview_id)||!Number.isSafeInteger(p.expected_revision))fail('Retain the exact original pending save request');validateDefinition(p.definition);}
 if(draft.source_snapshot!==undefined&&draft.source_snapshot!==null){const snap=draft.source_snapshot;const projection=sourceProjection(snap.sources,snap.definition.selection),rows=projection.rows;if(stable(snap.cohort)!==stable(projection.cohort))fail('The unfinished draft cohort metadata differs from its original files');if(!Array.isArray(snap.contexts)||snap.contexts.length!==rows.length||new Set(snap.contexts.map(x=>x.id)).size!==rows.length)fail('The unfinished draft source population differs');const contexts=new Map(snap.contexts.map(x=>[x.id,checkedContext(x)]));if(rows.some(row=>!contexts.has(row.id)))fail('The unfinished draft source context is missing');}
 const authored=clone(draft);delete authored.source_snapshot;delete authored.source_snapshot_error;bound(authored,BENCHMARK_LIMITS.draft_bytes,'Complete unfinished draft');return bound(clone(draft),BENCHMARK_LIMITS.study_bytes,'Complete draft source snapshot');
}
function draftKey(id){return 'observed-benchmark-draft:'+uid(id);}
export function saveBenchmarkDraft(w,body){
 uid(body.request_id);return artifactAtomic(w,()=>{
  const old=receipt(w,body,'draft');if(old)return old.result;
  const draft=checkedDraft(body.draft);
  if(Object.hasOwn(draft,'source_snapshot'))fail('Source snapshots are captured by the existing workspace; submit the original draft fields');
  let candidate=draft.pending_request?.definition||draft.structured_definition;if(!candidate){try{candidate=JSON.parse(draft.raw_definition);}catch{}}
  try{draft.source_snapshot=candidate?captureInput(w,candidate,{allowIncomplete:true}):null;}catch(error){if(!(error instanceof InputError)||draft.pending_request)throw error;draft.source_snapshot=null;draft.source_snapshot_error=error.message;}
  checkedDraft(draft);put(w,draftKey(draft.id),DRAFT,draft,draft.at);
  const result={request_id:body.request_id,request_sha256:hash(stable(body)),draft_id:draft.id,workspace_revision:w.revision()};
  retainedRequest(w,body,'draft',result);return result;
 });
}
export function readBenchmarkDraft(w,id){const draft=getRow(w,draftKey(id),DRAFT);if(!draft)fail('Saved draft not found',404);return checkedDraft(draft);}
function familyRows(w,kind){return w.db.prepare('SELECT content FROM exports WHERE kind=? ORDER BY created_at,id').all(kind).map(row=>JSON.parse(row.content));}
export function benchmarkCatalogue(w){return w.readConsistent(()=>{
 const cohorts=new Map(),sources=new Map(),studyList=familyRows(w,STUDY),draftList=familyRows(w,DRAFT);
 const add=(row,refs,basis=null)=>{
  const id=cohortId(row);let c=cohorts.get(id);if(!c){c={id,...cohortOf(row),record_count:0,station_ids:[],source_ids:[],retained_bases:[],from:row.sampledDate,to:row.sampledDate,_ids:new Set()};cohorts.set(id,c);}
  if(!c._ids.has(row.id)){c._ids.add(row.id);c.record_count++;}c.from=c.from<row.sampledDate?c.from:row.sampledDate;c.to=c.to>row.sampledDate?c.to:row.sampledDate;
  if(!c.station_ids.includes(row.stationId))c.station_ids.push(row.stationId);
  for(const source of refs)if(!c.source_ids.includes(source.id))c.source_ids.push(source.id);
  if(basis&&!c.retained_bases.some(b=>b.kind===basis.kind&&b.id===basis.id))c.retained_bases.push(basis);
 };
 for(const source of w.db.prepare("SELECT id,label,sha,kind,created_at FROM imports WHERE kind!='stations' ORDER BY created_at,id").all())sources.set(source.id,{...source,current:true});
 for(const row of w.iterate({}))add(row,w.recordSources(row.id));
 for(const [kind,items]of [['study',studyList],['draft',draftList]])for(const value of items){
  const input=kind==='study'?value.input:value.source_snapshot;if(!input)continue;
  for(const source of input.sources)if(!sources.has(source.id))sources.set(source.id,{id:source.id,label:source.label,sha:source.sha,kind:source.kind,created_at:source.created_at,current:false});
  const rows=kind==='study'?value.result.rows:sourceRows(input.sources,input.definition.selection);
  for(const row of rows)if(row.selection_match!==false)add(row,row.sourceReferences,{kind,id:value.id,title:kind==='study'?value.input.definition.title:value.title});
  if(!rows.some(row=>row.selection_match!==false)){
   const selection=input.definition.selection,id=selection.cohort_id,basis={kind,id:value.id,title:kind==='study'?value.input.definition.title:value.title};
   if(!cohorts.has(id))cohorts.set(id,{id,...clone(input.cohort),record_count:0,station_ids:[...selection.station_ids],source_ids:[...selection.source_ids],retained_bases:[],from:selection.from,to:selection.to,_ids:new Set()});
   const c=cohorts.get(id);if(!c.retained_bases.some(b=>b.kind===kind&&b.id===value.id))c.retained_bases.push(basis);
  }
 }
 for(const c of cohorts.values()){c.station_ids.sort();c.source_ids.sort();delete c._ids;}
 return{workspace_revision:w.revision(),cohorts:[...cohorts.values()],sources:[...sources.values()],
  studies:studyList.map(s=>({id:s.id,study_id:s.study_id,parent_id:s.parent_id,title:s.input.definition.title,actor:s.input.definition.actor,at:s.input.definition.at,summary:s.result.summary})),
  drafts:draftList.map(d=>({id:d.id,title:d.title,actor:d.actor,at:d.at})),limits:BENCHMARK_LIMITS};
 });}
function validateProject(project){
 bound(project,BENCHMARK_LIMITS.project_bytes,'Complete benchmark project');
 if(project?.format!=='upstate.observed-benchmark-project/v1'||!Array.isArray(project.studies)||!Array.isArray(project.drafts)||!Array.isArray(project.requests))fail('Choose a complete original benchmark project');
 const studies=project.studies.map(validateStudy),drafts=project.drafts.map(checkedDraft),sm=new Map(studies.map(s=>[s.id,s])),dm=new Map(drafts.map(d=>[d.id,d]));
 if(sm.size!==studies.length||dm.size!==drafts.length)fail('Duplicate immutable study or working-copy identity');
 for(const study of studies){if(study.parent_id&&(!sm.has(study.parent_id)||sm.get(study.parent_id).study_id!==study.study_id))fail('Retain the complete parent-edition history');const seenParents=new Set();let cursor=study;while(cursor){if(seenParents.has(cursor.id))fail('Cyclic study history');seenParents.add(cursor.id);cursor=cursor.parent_id?sm.get(cursor.parent_id):null;}}
 for(const draft of drafts)if(draft.base_study_id&&!sm.has(draft.base_study_id))fail('Retain the original working-copy basis');
 for(const item of [...studies.map(s=>s.input.definition),...drafts.map(d=>d.structured_definition).filter(Boolean)]){const b=item.source_basis;if(b&&(b.kind==='study'?!sm.has(b.id):!dm.has(b.id)))fail('Retain the exact historical source basis');}
 for(const [kind,items]of [['study',studies],['draft',drafts]])for(const item of items){
  const input=kind==='study'?item.input:item.source_snapshot;if(!input)continue;
  const b=input.definition.source_basis;if(!b)continue;
  const basis=b.kind==='study'?sm.get(b.id)?.input:dm.get(b.id)?.source_snapshot;
  if(!basis)fail('The historical source basis snapshot is absent');
  if(input.workspace_revision!==basis.workspace_revision)fail('The historical source revision changed');
  const originals=new Map(basis.sources.map(x=>[x.id,x])),contexts=new Map(basis.contexts.map(x=>[x.id,x]));
  for(const source of input.sources)if(stable(source)!==stable(originals.get(source.id)))fail('A historical source file differs from its original basis');
  for(const context of input.contexts)if(stable(context)!==stable(contexts.get(context.id)))fail('Historical scientific review context differs from its basis');
 }
 const requests=clone(project.requests),seen=new Set();
 for(const q of requests){
  uid(q.request_id);if(seen.has(q.request_id))fail('Duplicate accepted request');seen.add(q.request_id);
  if(q.format!=='upstate.observed-benchmark-request/v1'||!['save','draft','receive'].includes(q.action)||!SHA.test(q.request_sha256)||q.result?.request_id!==q.request_id||q.result?.request_sha256!==q.request_sha256)fail('Invalid original accepted request receipt');
  if(q.action==='receive'){if(q.body!==null||!SHA.test(q.result.project_sha256))fail('Retain received-project identity');continue;}
  if(q.body?.request_id!==q.request_id||hash(stable(q.body))!==q.request_sha256)fail('Original accepted request bytes differ');
  if(q.action==='save'&&q.result.abandoned===true){validateDefinition(q.body.definition);if(!q.result.abandon?.actor?.trim()||!q.result.abandon?.reason?.trim()||!Number.isFinite(Date.parse(q.result.abandon?.at)))fail('Original retired request attribution is missing');continue;}
  if(q.action==='save'){const s=sm.get(q.result.study_id);if(!s||q.body.expected_preview_id!==s.id||q.body.expected_revision!==s.input.workspace_revision||stable(q.body.definition)!==stable(s.input.definition))fail('Saved request is detached from its original study');}
  if(q.action==='draft'){const d=dm.get(q.result.draft_id);const authored=clone(d||{});delete authored.source_snapshot;delete authored.source_snapshot_error;if(!d||stable(q.body.draft)!==stable(authored))fail('Saved request is detached from its original working copy');}
 }
 return{format:project.format,studies,drafts,requests};
}
export function benchmarkProject(w){return w.readConsistent(()=>validateProject({format:'upstate.observed-benchmark-project/v1',studies:familyRows(w,STUDY),drafts:familyRows(w,DRAFT),requests:familyRows(w,REQUEST)}));}
export function receiveBenchmarks(w,body){
 uid(body.request_id);if(typeof body.actor!=='string'||!body.actor.trim()||body.actor.length>240||typeof body.note!=='string'||!body.note.trim()||body.note.length>8000||typeof body.at!=='string'||body.at.length>80||!Number.isFinite(Date.parse(body.at)))fail('Attribute this original project receiving within the original text limits');
 return artifactAtomic(w,()=>{
  const old=receipt(w,body,'receive');if(old)return old.result;
  const project=validateProject(body.project);let added=0;
  for(const s of project.studies)added+=Number(put(w,s.id,STUDY,s,s.input.definition.at));
  for(const d of project.drafts)added+=Number(put(w,draftKey(d.id),DRAFT,d,d.at));
  for(const q of project.requests)added+=Number(put(w,requestKey(q.request_id),REQUEST,q,body.at));
  const result={request_id:body.request_id,request_sha256:hash(stable(body)),project_sha256:hash(stable(project)),added,workspace_revision:w.revision()};
  retainedRequest(w,body,'receive',result);w.event('observed-benchmark-receive',result.project_sha256,{request_id:body.request_id,actor:body.actor,at:body.at,note:body.note,added});
  return result;
 });
}
/** Called before original full-workspace receive admits its existing exports table. */
export function validateBenchmarkExports(rows){
 const values=kind=>rows.filter(r=>r.kind===kind).map(r=>JSON.parse(r.content));
 const project=validateProject({format:'upstate.observed-benchmark-project/v1',studies:values(STUDY),drafts:values(DRAFT),requests:values(REQUEST)});
 for(const row of rows){if(![STUDY,DRAFT,REQUEST].includes(row.kind))continue;const v=JSON.parse(row.content),id=row.kind===STUDY?v.id:row.kind===DRAFT?draftKey(v.id):requestKey(v.request_id);if(row.id!==id)fail('Original benchmark export row identity differs');}
 return project;
}
export function benchmarkCSV(study,kind='rows'){
 study=validateStudy(study);
 if(kind==='rows')return csv(study.result.rows,['id','logicalKey','stationId','sampledDate','sampledAt','characteristic','parameter','fraction','unit','basis','method','reportedValue','reportedUnit','value','lower','upper','censor','detection','qualifier','issues','status','reason','period','selection_match','period_ambiguous','countable','sourceReferences','review','selectedVersion','variant_ids','version_choice','raw']);
 if(kind==='periods')return csv(study.result.periods,['station_id','period','start','end','total_rows','selected_samples','condition','not_condition','indeterminate','excluded','unallocated_samples','condition_count_min','condition_count_max','condition_fraction_min','condition_fraction_max','minimum_samples','support','status']);
 fail('Choose rows or periods CSV');
}
export async function benchmarkOperation(w,method,parts,body={}){
 if(method==='GET'&&parts.length===1&&parts[0]==='catalogue')return benchmarkCatalogue(w);
 if(method==='GET'&&parts.length===1&&parts[0]==='project')return benchmarkProject(w);
 if(method==='GET'&&parts.length===2&&parts[0]==='studies')return readBenchmark(w,parts[1]);
 if(method==='GET'&&parts.length===2&&parts[0]==='drafts')return readBenchmarkDraft(w,parts[1]);
 if(method==='GET'&&parts.length===2&&parts[0]==='requests')return benchmarkRequest(w,parts[1]);
 if(method==='POST'&&parts.length===1){if(parts[0]==='preview')return previewBenchmark(w,body);if(parts[0]==='save')return saveBenchmark(w,body);if(parts[0]==='abandon')return abandonBenchmark(w,body);if(parts[0]==='drafts')return saveBenchmarkDraft(w,body);if(parts[0]==='receive')return receiveBenchmarks(w,body);}
 fail('Observed-benchmark operation not found',404);
}
