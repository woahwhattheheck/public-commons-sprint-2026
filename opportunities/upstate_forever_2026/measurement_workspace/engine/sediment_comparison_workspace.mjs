/** Saved common-population comparisons in the existing Measurements exports/events store. */
import {hash,stable} from './normalise.mjs';
import {InputError} from './parse.mjs';
import {validateSedimentExports} from './sediment_workspace.mjs';
import {compareSedimentStudies,catalogueSedimentComparison,SEDIMENT_COMPARISON_LIMITS} from './sediment_comparison.mjs';

const RECORD='sediment-model-comparison',DRAFT=RECORD+'-draft',REQUEST=RECORD+'-request';
const S='sediment-surrogate-study',D='sediment-surrogate-draft',Q='sediment-surrogate-request';
const FORMAT='upstate.sediment-comparison-project/v1',EDITION='upstate.sediment-comparison-edition/v1',RECIPE='upstate.sediment-comparison-recipe/v1';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clone=v=>JSON.parse(JSON.stringify(v)),digest=v=>hash(stable(v));
const fail=(m,status=400)=>{throw new InputError(m,status);};
function object(v,label){if(!v||typeof v!=='object'||Array.isArray(v))fail(label+' must be an object');return v;}
function exact(v,keys,label){object(v,label);if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail('Retain exactly the declared '+label+' fields');return v;}
function text(v,label,max=8000,blank=false){if(typeof v!=='string'||v.length>max||v.includes('\0')||(!blank&&!v.trim()))fail('Retain '+label+' as original bounded text');return v;}
function uuid(v){if(typeof v!=='string'||!UUID.test(v))fail('Retain an original request or named-copy UUID');return v;}
function sha(v){if(typeof v!=='string'||!SHA.test(v))fail('Retain an original SHA-256 identity');return v;}
function time(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))fail('Retain an actual zoned ISO authoring time');return v;}
function bound(v,n,label){if(Buffer.byteLength(JSON.stringify(v),'utf8')>n)fail('Complete '+label+' exceeds '+n+' bytes; retain every original and explicitly choose a smaller complete project',413);return v;}
function list(v,label,validator=sha){if(!Array.isArray(v)||new Set(v).size!==v.length)fail('Retain each '+label+' once in original order');v.forEach(validator);return v;}
const key=(kind,id)=>kind+':'+uuid(id);
function get(w,id,kind){const row=w.db.prepare('SELECT content FROM exports WHERE id=? AND kind=?').get(id,kind);return row?JSON.parse(row.content):null;}
function family(w,kind){return w.db.prepare('SELECT content FROM exports WHERE kind=? ORDER BY created_at,id').all(kind).map(r=>JSON.parse(r.content));}
function put(w,id,kind,value,at){const prior=w.db.prepare('SELECT kind,content FROM exports WHERE id=?').get(id);if(prior){if(prior.kind!==kind||stable(JSON.parse(prior.content))!==stable(value))fail('An immutable comparison identity contains different original content',409);return false;}w.db.prepare('INSERT INTO exports(id,created_at,revision,kind,content) VALUES(?,?,?,?,?)').run(id,at,w.revision(),kind,JSON.stringify(value));return true;}
function atomic(w,fn){w.db.exec('BEGIN IMMEDIATE');try{const v=fn();w.db.exec('COMMIT');return v;}catch(e){w.db.exec('ROLLBACK');throw e;}}
function storedStudy(w,id){const value=get(w,sha(id),S);if(!value)fail('Original saved candidate not found',404);return value;}
function selectedStudies(w,ids){list(ids,'selected saved study');return ids.map(id=>storedStudy(w,id));}
function edition(document,parent_id){if(parent_id!==null)sha(parent_id);return {format:EDITION,id:digest({document_id:document.id,parent_id}),comparison_id:document.input.selection.id,parent_id,document};}
function recipe(value){const d=value.document;return {format:RECIPE,id:value.id,comparison_id:value.comparison_id,parent_id:value.parent_id,document_id:d.id,study_ids:d.input.studies.map(s=>s.id),selection:clone(d.input.selection),summary:{models:d.result.counts.models,common:d.result.counts.common,range_policy:d.input.selection.rangePolicy}};}
function rebuildRecipe(value,read){
 exact(value,['format','id','comparison_id','parent_id','document_id','study_ids','selection','summary'],'saved comparison recipe');
 if(value.format!==RECIPE)fail('Choose a complete saved comparison recipe');sha(value.id);uuid(value.comparison_id);sha(value.document_id);list(value.study_ids,'original candidate');
 const document=compareSedimentStudies(value.study_ids.map(id=>read(id)),value.selection),rebuilt=edition(document,value.parent_id);
 if(stable(recipe(rebuilt))!==stable(value))fail('Saved comparison differs from original candidate sources or selection',409);return rebuilt;
}
export function readSedimentComparison(w,id){return w.readConsistent(()=>{const value=get(w,sha(id),RECORD);if(!value)fail('Saved comparison not found',404);return rebuildRecipe(value,x=>storedStudy(w,x));});}
function checkedDraft(v,studies){
 exact(v,['id','title','actor','at','note','parent_id','study_ids','selection'],'unfinished comparison draft');uuid(v.id);text(v.title,'draft title',240);text(v.actor,'draft author',240);time(v.at);text(v.note,'draft note',16000,true);
 if(v.parent_id!==null)sha(v.parent_id);list(v.study_ids,'draft source candidate');object(v.selection,'unfinished comparison selection');
 if(studies)for(const id of v.study_ids)if(!studies.has(id))fail('An original draft candidate is absent');
 return bound(clone(v),4*1024*1024,'unfinished comparison draft');
}
export function readSedimentComparisonDraft(w,id){const value=get(w,key(DRAFT,id),DRAFT);if(!value)fail('Saved comparison draft not found',404);return checkedDraft(value);}
function preview(w,body){exact(body,['selection','parent_id'],'comparison preview');const ids=body.selection?.models?.map(m=>m.studyId);const document=compareSedimentStudies(selectedStudies(w,ids),body.selection);return edition(document,body.parent_id);}
export function previewSedimentComparison(w,body){return w.readConsistent(()=>preview(w,body));}
export function sedimentComparisonCandidates(w,body){exact(body,['study_ids'],'comparison candidate selection');return w.readConsistent(()=>catalogueSedimentComparison(selectedStudies(w,body.study_ids)));}
function checkParent(value,records){if(value.parent_id){const p=records.get(value.parent_id);if(!p||p.comparison_id!==value.comparison_id||Date.parse(p.selection.at)>Date.parse(value.selection.at))fail('Retain the complete original comparison ancestry');}}
function mapOf(values,field,label){const m=new Map(values.map(v=>[v[field],v]));if(m.size!==values.length)fail('Duplicate '+label+' identity');return m;}
function sedimentRows(p){
 exact(p,['format','studies','drafts','requests'],'original saved-study project');
 if(p?.format!=='upstate.sediment-surrogate-project/v1'||!Array.isArray(p.studies)||!Array.isArray(p.drafts)||!Array.isArray(p.requests))fail('Retain the complete original saved-study project');
 return [...p.studies.map(v=>({id:v.id,kind:S,content:JSON.stringify(v)})),...p.drafts.map(v=>({id:D+':'+v.id,kind:D,content:JSON.stringify(v)})),...p.requests.map(v=>({id:Q+':'+v.request_id,kind:Q,content:JSON.stringify(v)}))];
}
function maps(project){return {studies:mapOf(project.sediment.studies,'id','study'),studyDrafts:mapOf(project.sediment.drafts,'id','study draft'),studyRequests:mapOf(project.sediment.requests,'request_id','study request'),comparisons:mapOf(project.comparisons,'id','comparison'),drafts:mapOf(project.drafts,'id','comparison draft'),requests:mapOf(project.requests,'request_id','comparison request')};}
function members(project){return {format:project.format,sediment:{format:project.sediment.format,studyIds:project.sediment.studies.map(s=>s.id),draftIds:project.sediment.drafts.map(d=>d.id),requestIds:project.sediment.requests.map(q=>q.request_id)},comparisonIds:project.comparisons.map(c=>c.id),draftIds:project.drafts.map(d=>d.id),requestIds:project.requests.map(q=>q.request_id)};}
function fromMembers(value,m){
 exact(value,['format','sediment','comparisonIds','draftIds','requestIds'],'original comparison receiving membership');
 exact(value.sediment,['format','studyIds','draftIds','requestIds'],'original saved-study membership');
 if(value.format!==FORMAT||value.sediment.format!=='upstate.sediment-surrogate-project/v1')fail('Original project format differs');
 const take=(ids,map,label,validator=sha)=>list(ids,label,validator).map(id=>{const v=map.get(id);if(!v)fail('Complete original '+label+' member is absent');return v;});
 return {format:FORMAT,sediment:{format:value.sediment.format,studies:take(value.sediment.studyIds,m.studies,'study'),drafts:take(value.sediment.draftIds,m.studyDrafts,'study draft',uuid),requests:take(value.sediment.requestIds,m.studyRequests,'study request',uuid)},comparisons:take(value.comparisonIds,m.comparisons,'comparison'),drafts:take(value.draftIds,m.drafts,'comparison draft',uuid),requests:take(value.requestIds,m.requests,'comparison request',uuid)};
}
function checkRequest(q,m,verified=new Set(),visiting=new Set()){
 if(verified.has(q?.request_id))return q;if(visiting.has(q?.request_id))fail('Cyclic comparison receiving recipe');visiting.add(q?.request_id);
 exact(q,['format','request_id','action','request_sha256','body','result'],'original comparison request');
 if(q.format!=='upstate.sediment-comparison-request/v1'||!['save','draft','receive'].includes(q.action))fail('Unknown comparison request');uuid(q.request_id);sha(q.request_sha256);
 if(q.body?.request_id!==q.request_id||q.result?.request_id!==q.request_id||q.result?.request_sha256!==q.request_sha256)fail('Comparison request identity is detached');
 if(q.action==='receive'){
  exact(q.body,['request_id','actor','at','note','project'],'comparison receiving recipe');text(q.body.actor,'receiving author',240);time(q.body.at);text(q.body.note,'receiving note');
  const p=fromMembers(q.body.project,m);for(const child of p.requests)checkRequest(child,m,verified,visiting);
  if(digest(p)!==q.result.project_sha256||digest({...q.body,project:p})!==q.request_sha256)fail('Complete original receiving project or request bytes differ');
 }else{
  if(digest(q.body)!==q.request_sha256)fail('Original comparison request bytes differ');
  if(q.action==='save'){
   exact(q.body,['request_id','expected_preview_id','selection','parent_id'],'original comparison save');
   if(q.result.abandoned){exact(q.result.abandon,['actor','at','reason'],'retired request attribution');text(q.result.abandon.actor,'retiring author',240);time(q.result.abandon.at);text(q.result.abandon.reason,'retiring reason');}
   else {const c=m.comparisons.get(q.result.comparison_id);if(!c||q.body.expected_preview_id!==c.id||q.body.parent_id!==c.parent_id||stable(q.body.selection)!==stable(c.selection))fail('Original save request is detached from comparison edition');}
  }else{exact(q.body,['request_id','draft'],'original draft save');if(stable(q.body.draft)!==stable(m.drafts.get(q.result.draft_id)))fail('Original comparison draft request differs');}
 }
 verified.add(q.request_id);visiting.delete(q.request_id);return q;
}
function validateProject(value){
 bound(value,SEDIMENT_COMPARISON_LIMITS.bytes,'comparison project');exact(value,['format','sediment','comparisons','drafts','requests'],'comparison project');
 if(value.format!==FORMAT||!['comparisons','drafts','requests'].every(k=>Array.isArray(value[k])))fail('Choose a complete comparison project');
 validateSedimentExports(sedimentRows(value.sediment));const m=maps(value);
 for(const c of value.comparisons){rebuildRecipe(c,id=>{const s=m.studies.get(id);if(!s)fail('Original comparison candidate is absent');return s;});checkParent(c,m.comparisons);const seen=new Set();let current=c;while(current){if(seen.has(current.id))fail('Cyclic comparison ancestry');seen.add(current.id);current=current.parent_id?m.comparisons.get(current.parent_id):null;}}
 for(const d of value.drafts){checkedDraft(d,m.studies);if(d.parent_id&&!m.comparisons.has(d.parent_id))fail('Original draft comparison parent is absent');}
 const verified=new Set();for(const q of value.requests)checkRequest(q,m,verified);
 return value;
}
function projectFromStore(w){return {format:FORMAT,sediment:{format:'upstate.sediment-surrogate-project/v1',studies:family(w,S),drafts:family(w,D),requests:family(w,Q)},comparisons:family(w,RECORD),drafts:family(w,DRAFT),requests:family(w,REQUEST)};}
export function sedimentComparisonProject(w){return w.readConsistent(()=>clone(validateProject(projectFromStore(w))));}
function retainedMaps(w){return maps(projectFromStore(w));}
function oldRequest(w,body,action){
 const q=get(w,key(REQUEST,body.request_id),REQUEST);if(!q)return null;
 if(q.action!==action||q.request_sha256!==digest(body))fail('This UUID belongs to different original command bytes or action',409);
 return checkRequest(q,retainedMaps(w));
}
function storeRequest(w,body,action,result){
 const q={format:'upstate.sediment-comparison-request/v1',request_id:body.request_id,action,request_sha256:digest(body),body:action==='receive'?{request_id:body.request_id,actor:body.actor,at:body.at,note:body.note,project:members(body.project)}:clone(body),result};
 put(w,key(REQUEST,body.request_id),REQUEST,q,new Date().toISOString());return q;
}
export function sedimentComparisonRequest(w,id){return w.readConsistent(()=>{const q=get(w,key(REQUEST,id),REQUEST);if(!q)return {request_id:id,committed:false};checkRequest(q,retainedMaps(w));return {request_id:id,committed:true,request:q};});}
export function saveSedimentComparison(w,body){
 exact(body,['request_id','expected_preview_id','selection','parent_id'],'comparison save');uuid(body.request_id);sha(body.expected_preview_id);
 return atomic(w,()=>{
  const old=oldRequest(w,body,'save');if(old)return old.result;
  const value=preview(w,{selection:body.selection,parent_id:body.parent_id});if(value.id!==body.expected_preview_id)fail('Inspect the complete current preview before saving this comparison',409);
  const saved=recipe(value),records=mapOf(family(w,RECORD),'id','comparison');checkParent(saved,records);
  if(saved.parent_id===null&&[...records.values()].some(c=>c.comparison_id===saved.comparison_id))fail('Choose the retained comparison parent when authoring another edition',409);
  put(w,saved.id,RECORD,saved,saved.selection.at);
  const result={request_id:body.request_id,request_sha256:digest(body),comparison_id:saved.id,workspace_revision:w.revision()};
  storeRequest(w,body,'save',result);w.event(RECORD,saved.id,{comparison_id:saved.comparison_id,parent_id:saved.parent_id,title:saved.selection.title,actor:saved.selection.actor,at:saved.selection.at,request_id:body.request_id});return result;
 });
}
export function saveSedimentComparisonDraft(w,body){
 exact(body,['request_id','draft'],'comparison draft save');uuid(body.request_id);
 return atomic(w,()=>{const old=oldRequest(w,body,'draft');if(old)return old.result;const d=checkedDraft(body.draft,new Map(family(w,S).map(s=>[s.id,s])));if(d.parent_id&&!get(w,d.parent_id,RECORD))fail('Original comparison parent is absent');put(w,key(DRAFT,d.id),DRAFT,d,d.at);const result={request_id:body.request_id,request_sha256:digest(body),draft_id:d.id,workspace_revision:w.revision()};storeRequest(w,body,'draft',result);w.event(DRAFT,d.id,{title:d.title,actor:d.actor,at:d.at,request_id:body.request_id});return result;});
}
export function abandonSedimentComparisonRequest(w,body){
 exact(body,['request_id','original','actor','at','reason'],'comparison request retirement');uuid(body.request_id);text(body.actor,'retiring author',240);time(body.at);text(body.reason,'retiring reason');
 exact(body.original,['request_id','expected_preview_id','selection','parent_id'],'original comparison save');if(body.original.request_id!==body.request_id)fail('Retain the exact original pending request identity');
 return atomic(w,()=>{const old=oldRequest(w,body.original,'save');if(old)return old.result;sha(body.original.expected_preview_id);object(body.original.selection,'original pending selection');if(body.original.parent_id!==null)sha(body.original.parent_id);const result={request_id:body.request_id,request_sha256:digest(body.original),abandoned:true,abandon:{actor:body.actor,at:body.at,reason:body.reason},workspace_revision:w.revision()};storeRequest(w,body.original,'save',result);w.event(REQUEST,body.request_id,{abandoned:true,...result.abandon});return result;});
}
export function receiveSedimentComparisonProject(w,body){
 exact(body,['request_id','actor','at','note','project'],'comparison project receive');uuid(body.request_id);text(body.actor,'receiving author',240);time(body.at);text(body.note,'receiving note');
 return atomic(w,()=>{
  const old=oldRequest(w,body,'receive');if(old)return old.result;const p=validateProject(body.project);let added=0;
  for(const row of sedimentRows(p.sediment)){const value=JSON.parse(row.content);added+=Number(put(w,row.id,row.kind,value,row.kind===S?value.input.definition.at:row.kind===D?value.at:body.at));}
  for(const c of p.comparisons)added+=Number(put(w,c.id,RECORD,c,c.selection.at));
  for(const d of p.drafts)added+=Number(put(w,key(DRAFT,d.id),DRAFT,d,d.at));
  for(const q of p.requests)added+=Number(put(w,key(REQUEST,q.request_id),REQUEST,q,body.at));
  // Check the union before commit: retained local ancestry and request identities remain authoritative.
  validateProject(projectFromStore(w));
  const result={request_id:body.request_id,request_sha256:digest(body),project_sha256:digest(p),added,workspace_revision:w.revision()};
  storeRequest(w,body,'receive',result);validateProject(projectFromStore(w));w.event(RECORD+'-receive',result.project_sha256,{request_id:body.request_id,actor:body.actor,at:body.at,note:body.note,added});return result;
 });
}
export function sedimentComparisonCatalogue(w){return w.readConsistent(()=>{return {workspace_identity:hash(String(w.directory)),workspace_revision:w.revision(),comparisons:family(w,RECORD).map(c=>({id:c.id,comparison_id:c.comparison_id,parent_id:c.parent_id,title:c.selection.title,actor:c.selection.actor,at:c.selection.at,...c.summary})),drafts:family(w,DRAFT).map(d=>({id:d.id,title:d.title,actor:d.actor,at:d.at,parent_id:d.parent_id,source_count:d.study_ids.length})),studies:family(w,S).map(s=>({id:s.id,study_id:s.study_id,parent_id:s.parent_id,title:s.input.definition.title,actor:s.input.definition.actor,at:s.input.definition.at,model:s.input.definition.model,source_basis:s.input.definition.source_basis})),limits:{...SEDIMENT_COMPARISON_LIMITS,draft_bytes:4*1024*1024}};});}
export function validateSedimentComparisonExports(rows){
 const items=k=>rows.filter(r=>r.kind===k).map(r=>JSON.parse(r.content));
 if(!rows.some(r=>[RECORD,DRAFT,REQUEST].includes(r.kind)))return;
 const p={format:FORMAT,sediment:{format:'upstate.sediment-surrogate-project/v1',studies:items(S),drafts:items(D),requests:items(Q)},comparisons:items(RECORD),drafts:items(DRAFT),requests:items(REQUEST)};
 validateProject(p);
 for(const r of rows){if(![RECORD,DRAFT,REQUEST].includes(r.kind))continue;const v=JSON.parse(r.content),expected=r.kind===RECORD?v.id:key(r.kind,r.kind===DRAFT?v.id:v.request_id);if(r.id!==expected)fail('Original comparison export row identity differs');}
}
export function sedimentComparisonOperation(w,method,parts,body={}){
 if(method==='GET'&&parts.length===1){if(parts[0]==='catalogue')return sedimentComparisonCatalogue(w);if(parts[0]==='project')return sedimentComparisonProject(w);}
 if(method==='GET'&&parts.length===2){if(parts[0]==='comparisons')return readSedimentComparison(w,parts[1]);if(parts[0]==='drafts')return readSedimentComparisonDraft(w,parts[1]);if(parts[0]==='requests')return sedimentComparisonRequest(w,parts[1]);}
 if(method==='POST'&&parts.length===1){if(parts[0]==='candidates')return sedimentComparisonCandidates(w,body);if(parts[0]==='preview')return previewSedimentComparison(w,body);if(parts[0]==='save')return saveSedimentComparison(w,body);if(parts[0]==='drafts')return saveSedimentComparisonDraft(w,body);if(parts[0]==='abandon')return abandonSedimentComparisonRequest(w,body);if(parts[0]==='receive')return receiveSedimentComparisonProject(w,body);}
 fail('Sediment comparison operation not found',404);
}
