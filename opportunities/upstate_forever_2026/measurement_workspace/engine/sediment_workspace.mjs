/** Source-bound sediment studies in the original Measurements exports/events owner. */
import {hash,stable,parseSource} from './normalise.mjs';
import {InputError,SOURCE_LINE_EDITION,sourceLineEndings} from './parse.mjs';
import {verifySedimentReferenceImport} from '../reference/sediment-reference.mjs';
import {buildSedimentPairs,buildSedimentPredictionInput,sedimentObservationCatalogue} from './sediment_pairs.mjs';
import {fitSedimentSurrogate,predictSedimentSurrogate} from './sediment_surrogate.mjs';

const STUDY='sediment-surrogate-study',DRAFT='sediment-surrogate-draft',REQUEST='sediment-surrogate-request';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const SEDIMENT_LIMITS=Object.freeze({study_bytes:64*1024*1024,project_bytes:128*1024*1024-65536,draft_bytes:4*1024*1024});
const clone=value=>JSON.parse(JSON.stringify(value));
function fail(message,status=400){throw new InputError(message,status);}
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))fail(label+' must be an object');return value;}
function exact(value,keys,label){object(value,label);if(Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))fail('Retain exactly the declared '+label+' fields');return value;}
function text(value,label,max=8000,blank=false){if(typeof value!=='string'||value.length>max||value.includes('\0')||(!blank&&!value.trim()))fail('Retain '+label+' as bounded original text');return value;}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))fail('Retain an original UUID');return value;}
function sha(value){if(typeof value!=='string'||!SHA.test(value))fail('Retain an original SHA-256 identity');return value;}
function at(value){text(value,'observation time',80);if(!Number.isFinite(Date.parse(value)))fail('Retain an actual ISO observation time');return value;}
function bound(value,max,label){if(Buffer.byteLength(JSON.stringify(value),'utf8')>max)fail(label+' exceeds the complete '+max+' byte capacity. Retain the full inputs and select an explicitly smaller study; no rows were truncated.',413);return value;}
function parse(value){return typeof value==='string'?JSON.parse(value):clone(value);}
function sourceIds(definition){
 const primary=definition?.selection?.source_ids;
 const secondary=definition?.deployment?.source_ids||[];
 if(!Array.isArray(primary)||!Array.isArray(secondary))fail('Select complete fit and prediction source lists');
 const ids=[...new Set([...primary,...secondary])];
 if(!ids.length||new Set(primary).size!==primary.length||new Set(secondary).size!==secondary.length)fail('Select each complete original source once');
 ids.forEach(sha);return ids;
}
export function validateSedimentDefinition(value){
 exact(value,['study_id','parent_id','title','actor','at','note','selection','model','deployment','source_basis'],'sediment study definition');
 uuid(value.study_id);if(value.parent_id!==null)sha(value.parent_id);
 text(value.title,'study title',240);text(value.actor,'scientific author',240);at(value.at);text(value.note,'study note',16000,true);
 object(value.selection,'source selection');sourceIds(value);object(value.model,'model selection');
 if(value.deployment!==null)object(value.deployment,'prediction selection');
 if(value.source_basis!==null){exact(value.source_basis,['kind','id'],'historical source basis');if(!['study','draft'].includes(value.source_basis.kind))fail('Select a study or saved draft source basis');value.source_basis.kind==='study'?sha(value.source_basis.id):uuid(value.source_basis.id);}
 return clone(value);
}
function originalSource(workspace,id){
 const row=workspace.source(id);if(!['wqp','usgs-daily'].includes(row.kind))fail('Choose original measured-observation files');
 return {id:row.id,kind:row.kind,label:row.label,created_at:row.created_at,sha:row.sha,content:row.content,mapping:parse(row.mapping),origin:parse(row.origin),summary:parse(row.summary),rejected:parse(row.rejected)};
}
function summaryOf(parsed){
 const value={rows:parsed.rows.length,rejectedCount:parsed.rejected.length,stationCount:new Set(parsed.rows.map(x=>x.row.stationId||x.row.id)).size,censored:parsed.rows.filter(x=>x.row.censor&&x.row.censor!=='none').length,parameters:{},issues:{}};
 if(parsed.kind!=='usgs-daily'&&parsed.lineEndings==='physical')value.sourceLineEdition=SOURCE_LINE_EDITION;
 for(const {row}of parsed.rows){if(row.parameter)value.parameters[row.parameter]=(value.parameters[row.parameter]||0)+1;for(const issue of row.issues||[])value.issues[issue]=(value.issues[issue]||0)+1;}return value;
}
function reconstructSources(sources,definition){
 const selected=sourceIds(definition);
 if(!Array.isArray(sources)||sources.length!==selected.length||new Set(sources.map(s=>s?.id)).size!==sources.length)fail('Retain the complete selected source inventory');
 const allowed=new Set(selected),records=new Map();
 for(const source of sources){
  if(!source||!allowed.has(source.id)||!['wqp','usgs-daily'].includes(source.kind)||typeof source.content!=='string'||hash(source.content)!==source.sha)fail('Original sediment source bytes differ');
  if(source.origin?.adapter==='upstate.usgs-07144100-calibration-intake/v1')verifySedimentReferenceImport({kind:source.kind,text:source.content,mapping:source.mapping,origin:source.origin});
  const parsed=parseSource({kind:source.kind,text:source.content,mapping:source.mapping,lineEndings:sourceLineEndings(source.summary)});
  if(hash(stable([source.kind,source.sha,parsed.mapping]))!==source.id||stable(parsed.mapping)!==stable(source.mapping))fail('Original source mapping or import identity differs');
  if(stable(parsed.rejected)!==stable(source.rejected)||stable(summaryOf(parsed))!==stable(source.summary))fail('Retain complete original source parsing and rejected rows');
  for(const page of source.origin?.pages||[])if(typeof page.text!=='string'||hash(page.text)!==page.sha)fail('Original acquired source page differs');
  for(const {line,row}of parsed.rows){
   const id=hash(stable([row.sourceKind,row]));let entry=records.get(id);
   if(!entry){entry={...row,id,sourceReferences:[]};records.set(id,entry);}
   entry.sourceReferences.push({id:source.id,sha:source.sha,label:source.label,source_line:line});
  }
 }
 return [...records.values()].map(row=>({...row,sourceReferences:row.sourceReferences.sort((a,b)=>a.id.localeCompare(b.id)||a.source_line-b.source_line)})).sort((a,b)=>a.id.localeCompare(b.id));
}
function checkedContext(value){
 exact(value,['id','review','selectedVersion','variants'],'native observation context');sha(value.id);
 if(!['pending','include','exclude'].includes(value.review?.state))fail('Retain the actual original measurement review');
 if(value.review.state!=='pending'&&(!value.review.reviewer||!value.review.reason))fail('Native measurement review attribution is absent');
 if(value.selectedVersion!==null)sha(value.selectedVersion);
 if(!Array.isArray(value.variants)||!value.variants.length||new Set(value.variants).size!==value.variants.length||!value.variants.includes(value.id))fail('Retain every known source revision identity');
 value.variants.forEach(sha);if(value.selectedVersion!==null&&!value.variants.includes(value.selectedVersion))fail('Selected native version is outside its original source family');
 return clone(value);
}
function inputRows(input){
 const rows=reconstructSources(input.sources,input.definition);
 if(!Number.isSafeInteger(input.workspace_revision)||input.workspace_revision<0)fail('Retain original Measurements revision');
 if(!Array.isArray(input.contexts)||input.contexts.length!==rows.length||new Set(input.contexts.map(c=>c?.id)).size!==rows.length)fail('Retain review context for every observation in the selected originals');
 const contexts=new Map(input.contexts.map(c=>[c.id,checkedContext(c)]));
 return rows.map(row=>{const c=contexts.get(row.id);if(!c)fail('Original observation review context is absent');return {...row,sources:clone(row.sourceReferences),review:c.review,selectedVersion:c.selectedVersion,variants:c.variants,variantCount:c.variants.length};});
}
function get(workspace,id,kind){
 const row=workspace.db.prepare('SELECT content FROM exports WHERE id=? AND kind=?').get(id,kind);
 return row?JSON.parse(row.content):null;
}
const draftKey=id=>'sediment-surrogate-draft:'+uuid(id),requestKey=id=>'sediment-surrogate-request:'+uuid(id);
function sourceBasis(workspace,definition){
 const b=definition?.source_basis;if(!b)return null;
 const item=get(workspace,b.kind==='draft'?draftKey(b.id):sha(b.id),b.kind==='draft'?DRAFT:STUDY);
 if(!item)fail('The selected historical source edition is not retained',404);
 const input=b.kind==='draft'?checkedDraft(item).source_snapshot:validateStudy(item).input;
 if(!input)fail('This unfinished draft has no captured valid source selection');
 return input;
}
function capture(workspace,definition,{unfinished=false}={}){
 if(!unfinished)definition=validateSedimentDefinition(definition);
 sourceIds(definition);const historical=sourceBasis(workspace,definition);
 const originals=historical?new Map(historical.sources.map(s=>[s.id,s])):null;
 const sources=sourceIds(definition).map(id=>{if(!originals)return originalSource(workspace,id);const item=originals.get(id);if(!item)fail('The historical basis does not contain this source; select current sources to broaden the study');return clone(item);});
 const rows=reconstructSources(sources,definition),prior=historical?new Map(historical.contexts.map(c=>[c.id,c])):null;
 const contexts=rows.map(row=>{if(prior){const c=prior.get(row.id);if(!c)fail('The historical basis does not contain this original row context');return checkedContext(c);}const native=workspace.record(row.id);return checkedContext({id:row.id,review:native.review,selectedVersion:native.selectedVersion||null,variants:native.variants});});
 return bound({definition:clone(definition),workspace_revision:historical?historical.workspace_revision:workspace.revision(),sources,contexts},SEDIMENT_LIMITS.study_bytes,'Complete scientific source input');
}
export function rebuildSedimentStudy(input){
 exact(input,['definition','workspace_revision','sources','contexts'],'scientific input');bound(input,SEDIMENT_LIMITS.study_bytes,'Complete scientific input');
 const definition=validateSedimentDefinition(input.definition),rows=inputRows(input);
 const pairing=buildSedimentPairs(rows,definition.selection);
 const fit=fitSedimentSurrogate(pairing,definition.model);
 const predictionInput=definition.deployment===null?null:buildSedimentPredictionInput(rows,definition.deployment,pairing);
 const predictions=predictionInput===null?null:predictSedimentSurrogate(fit,predictionInput);
 const normalized={definition,workspace_revision:input.workspace_revision,sources:clone(input.sources),contexts:clone(input.contexts)};
 return bound({format:'upstate.sediment-surrogate-study/v1',id:hash(stable(normalized)),study_id:definition.study_id,parent_id:definition.parent_id,input:normalized,result:{pairing,fit,predictions}},SEDIMENT_LIMITS.study_bytes,'Complete fitted study and predictions');
}
function validateStudy(study){
 if(study?.format!=='upstate.sediment-surrogate-study/v1')fail('Choose a complete original sediment study');
 const rebuilt=rebuildSedimentStudy(study.input);if(stable(rebuilt)!==stable(study))fail('Saved study differs from its complete original input or scientific calculation');return rebuilt;
}
export function readSedimentStudy(workspace,id){const study=get(workspace,sha(id),STUDY);if(!study)fail('Saved sediment study not found',404);return validateStudy(study);}
export function sedimentObservations(workspace,body){return workspace.readConsistent(()=>{const input=capture(workspace,body.definition,{unfinished:true});return bound({workspace_revision:input.workspace_revision,catalogue:sedimentObservationCatalogue(inputRows(input),body.interpret===true?input.definition.selection:undefined)},SEDIMENT_LIMITS.study_bytes,'Complete selected observation catalogue');});}
export function previewSedimentDeployment(workspace,body){return workspace.readConsistent(()=>{const input=capture(workspace,body.definition,{unfinished:true}),rows=inputRows(input),pairing=buildSedimentPairs(rows,input.definition.selection);if(!input.definition.deployment)fail('Choose a source-bound deployment selection');return bound({workspace_revision:input.workspace_revision,pairing_id:pairing.id,deployment:buildSedimentPredictionInput(rows,input.definition.deployment,pairing)},SEDIMENT_LIMITS.study_bytes,'Complete deployment candidate review');});}
export function previewSedimentPairs(workspace,body){return workspace.readConsistent(()=>{object(body,'pair preview');const input=capture(workspace,body.definition,{unfinished:true});return {workspace_revision:input.workspace_revision,input_sha256:hash(stable(input)),pairing:buildSedimentPairs(inputRows(input),input.definition.selection)};});}
export function previewSedimentStudy(workspace,body){return workspace.readConsistent(()=>rebuildSedimentStudy(capture(workspace,body.definition)));}
function atomic(workspace,fn){workspace.db.exec('BEGIN IMMEDIATE');try{const result=fn();workspace.db.exec('COMMIT');return result;}catch(error){workspace.db.exec('ROLLBACK');throw error;}}
function put(workspace,id,kind,value,time){
 const prior=workspace.db.prepare('SELECT kind,content FROM exports WHERE id=?').get(id);
 if(prior){if(prior.kind!==kind||stable(JSON.parse(prior.content))!==stable(value))fail('An immutable sediment identity already contains different original content',409);return false;}
 workspace.db.prepare('INSERT INTO exports(id,created_at,revision,kind,content) VALUES(?,?,?,?,?)').run(id,time,workspace.revision(),kind,JSON.stringify(value));return true;
}
function family(workspace,kind){return workspace.db.prepare('SELECT content FROM exports WHERE kind=? ORDER BY created_at,id').all(kind).map(r=>JSON.parse(r.content));}
function checkRequest(q,studies,drafts,requests=new Map(),verified=new Set(),visiting=new Set()){
 if(verified.has(q?.request_id))return q;if(visiting.has(q?.request_id))fail('Cyclic scientific receive recipe');visiting.add(q?.request_id);
 if(q?.format!=='upstate.sediment-surrogate-request/v1'||!['save','draft','receive'].includes(q.action))fail('Unknown saved scientific request');
 uuid(q.request_id);sha(q.request_sha256);if(q.result?.request_id!==q.request_id||q.result?.request_sha256!==q.request_sha256)fail('Saved request result is detached');
 if(q.action==='receive'){
  exact(q.body,['request_id','actor','at','note','project'],'original receiving recipe');if(q.body.request_id!==q.request_id)fail('Receiving recipe identity differs');text(q.body.actor,'receiving author',240);at(q.body.at);text(q.body.note,'receiving note');
  const recipe=q.body.project;exact(recipe,['format','studyIds','draftIds','requestIds'],'ordered receiving membership');
  if(recipe.format!=='upstate.sediment-surrogate-project/v1')fail('Original received format differs');
  for(const key of ['studyIds','draftIds','requestIds'])if(!Array.isArray(recipe[key])||new Set(recipe[key]).size!==recipe[key].length)fail('Retain each original receiving member once in original order');
  const take=(ids,map,validator)=>ids.map(id=>{const item=map.get(id);if(!item)fail('Complete original receiving member is absent');return validator(item);});
  const project={format:recipe.format,studies:take(recipe.studyIds,studies,validateStudy),drafts:take(recipe.draftIds,drafts,checkedDraft),requests:take(recipe.requestIds,requests,item=>checkRequest(item,studies,drafts,requests,verified,visiting))};
  const original={request_id:q.body.request_id,actor:q.body.actor,at:q.body.at,note:q.body.note,project};
  if(hash(stable(project))!==q.result.project_sha256||hash(stable(original))!==q.request_sha256)fail('Original complete receiving request or ordered project differs');
  visiting.delete(q.request_id);verified.add(q.request_id);return q;
 }
 if(q.body?.request_id!==q.request_id||hash(stable(q.body))!==q.request_sha256)fail('Original scientific request bytes differ');
 if(q.result.abandoned===true){if(q.action!=='save'||!q.result.abandon?.actor||!q.result.abandon?.reason)fail('Original retired request attribution is absent');at(q.result.abandon.at);validateSedimentDefinition(q.body.definition);visiting.delete(q.request_id);verified.add(q.request_id);return q;}
 if(q.action==='save'){
  const study=studies.get(q.result.study_id);if(!study||q.body.expected_preview_id!==study.id||q.body.expected_revision!==study.input.workspace_revision||stable(q.body.definition)!==stable(study.input.definition))fail('Saved request is detached from its scientific edition');
 }else{
  const draft=drafts.get(q.result.draft_id);if(!draft)fail('Saved request draft is absent');const authored=clone(draft);delete authored.source_snapshot;delete authored.source_snapshot_error;
  if(stable(authored)!==stable(q.body.draft))fail('Saved draft request bytes differ');
 }
 visiting.delete(q.request_id);verified.add(q.request_id);return q;
}
function oldRequest(workspace,body,action){
 const q=get(workspace,requestKey(body.request_id),REQUEST);if(!q)return null;
 if(q.action!==action||q.request_sha256!==hash(stable(body)))fail('This original UUID belongs to different command bytes or action',409);
 const studies=new Map(),drafts=new Map();
 if(q.action==='save'&&!q.result.abandoned){const s=readSedimentStudy(workspace,q.result.study_id);studies.set(s.id,s);}
 if(q.action==='draft'){const d=readSedimentDraft(workspace,q.result.draft_id);drafts.set(d.id,d);}
 if(q.action==='receive'){for(const s of family(workspace,STUDY))studies.set(s.id,s);for(const d of family(workspace,DRAFT))drafts.set(d.id,d);}
 return checkRequest(q,studies,drafts,new Map(family(workspace,REQUEST).map(r=>[r.request_id,r])));
}
function saveRequest(workspace,body,action,result){
 const value={format:'upstate.sediment-surrogate-request/v1',request_id:body.request_id,action,request_sha256:hash(stable(body)),body:action==='receive'?{request_id:body.request_id,actor:body.actor,at:body.at,note:body.note,project:{format:body.project.format,studyIds:body.project.studies.map(s=>s.id),draftIds:body.project.drafts.map(d=>d.id),requestIds:body.project.requests.map(q=>q.request_id)}}:clone(body),result};
 put(workspace,requestKey(body.request_id),REQUEST,value,new Date().toISOString());return value;
}
export function sedimentRequest(workspace,id){
 const q=get(workspace,requestKey(id),REQUEST);if(!q)return {request_id:id,committed:false};
 const studies=new Map(),drafts=new Map();if(q.action==='save'&&!q.result.abandoned){const s=readSedimentStudy(workspace,q.result.study_id);studies.set(s.id,s);}if(q.action==='draft'){const d=readSedimentDraft(workspace,q.result.draft_id);drafts.set(d.id,d);}
 if(q.action==='receive'){for(const s of family(workspace,STUDY))studies.set(s.id,s);for(const d of family(workspace,DRAFT))drafts.set(d.id,d);}
 checkRequest(q,studies,drafts,new Map(family(workspace,REQUEST).map(r=>[r.request_id,r])));return {request_id:id,committed:true,request:q};
}
export function saveSedimentStudy(workspace,body){
 exact(body,['request_id','expected_revision','expected_preview_id','definition'],'study save');uuid(body.request_id);
 return atomic(workspace,()=>{
  const old=oldRequest(workspace,body,'save');if(old)return old.result;
  const input=capture(workspace,body.definition);
  if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision!==input.workspace_revision)fail('Original sources or scientific reviews changed. Inspect a fresh preview before authoring a new request.',409);
  const study=rebuildSedimentStudy(input);if(body.expected_preview_id!==study.id)fail('The selected source/model preview differs; inspect its complete input before saving',409);
  if(study.parent_id){const parent=readSedimentStudy(workspace,study.parent_id);if(parent.study_id!==study.study_id)fail('The parent belongs to a different named study');if(Date.parse(study.input.definition.at)<Date.parse(parent.input.definition.at))fail('A following edition cannot predate its original parent');}
  else if(family(workspace,STUDY).some(s=>s.study_id===study.study_id))fail('Choose the retained parent when saving another named edition',409);
  put(workspace,study.id,STUDY,study,study.input.definition.at);
  const result={request_id:body.request_id,request_sha256:hash(stable(body)),study_id:study.id,workspace_revision:workspace.revision()};
  saveRequest(workspace,body,'save',result);workspace.event(STUDY,study.id,{study_id:study.study_id,parent_id:study.parent_id,title:study.input.definition.title,actor:study.input.definition.actor,at:study.input.definition.at,request_id:body.request_id});return result;
 });
}
function checkedDraft(value){
 object(value,'unfinished draft');
 exact(value,['id','title','actor','at','base_study_id','raw_definition','structured_definition','pending_request',...(Object.hasOwn(value,'source_snapshot')?['source_snapshot']:[]),...(Object.hasOwn(value,'source_snapshot_error')?['source_snapshot_error']:[])],'unfinished draft');
 uuid(value.id);text(value.title,'unfinished title',240,true);text(value.actor,'unfinished author',240,true);at(value.at);text(value.raw_definition,'unfinished original input',SEDIMENT_LIMITS.draft_bytes,true);
 if(value.base_study_id!==null)sha(value.base_study_id);if(value.structured_definition!==null)object(value.structured_definition,'last structured draft');
 if(value.pending_request!==null){const p=value.pending_request;exact(p,['request_id','expected_revision','expected_preview_id','definition'],'pending scientific save');uuid(p.request_id);sha(p.expected_preview_id);if(!Number.isSafeInteger(p.expected_revision)||p.expected_revision<0)fail('Retain pending source revision');validateSedimentDefinition(p.definition);}
 if(value.source_snapshot){inputRows(value.source_snapshot);if(value.pending_request&&hash(stable(value.source_snapshot))!==value.pending_request.expected_preview_id)fail('Pending request source snapshot differs from its original preview');}
 const authored=clone(value);delete authored.source_snapshot;delete authored.source_snapshot_error;bound(authored,SEDIMENT_LIMITS.draft_bytes,'Unfinished scientific controls');return bound(clone(value),SEDIMENT_LIMITS.study_bytes,'Complete unfinished draft and originals');
}
export function saveSedimentDraft(workspace,body){
 exact(body,['request_id','draft'],'draft save');uuid(body.request_id);return atomic(workspace,()=>{
  const old=oldRequest(workspace,body,'draft');if(old)return old.result;
  const draft=checkedDraft(body.draft);if(Object.hasOwn(draft,'source_snapshot')||Object.hasOwn(draft,'source_snapshot_error'))fail('Original workspace captures its own draft source snapshot');
  if(draft.base_study_id)readSedimentStudy(workspace,draft.base_study_id);
  let definition=draft.pending_request?.definition||draft.structured_definition;if(!definition){try{definition=JSON.parse(draft.raw_definition);}catch{}}
  try{draft.source_snapshot=definition?capture(workspace,definition,{unfinished:true}):null;}catch(error){if(!(error instanceof InputError)||draft.pending_request)throw error;draft.source_snapshot=null;draft.source_snapshot_error=error.message;}
  checkedDraft(draft);put(workspace,draftKey(draft.id),DRAFT,draft,draft.at);
  const result={request_id:body.request_id,request_sha256:hash(stable(body)),draft_id:draft.id,workspace_revision:workspace.revision()};saveRequest(workspace,body,'draft',result);return result;
 });
}
export function readSedimentDraft(workspace,id){const draft=get(workspace,draftKey(id),DRAFT);if(!draft)fail('Saved sediment draft not found',404);return checkedDraft(draft);}
export function abandonSedimentRequest(workspace,body){
 exact(body,['request','actor','at','reason'],'explicit request retirement');const original=body.request;
 exact(original,['request_id','expected_revision','expected_preview_id','definition'],'original save');uuid(original.request_id);sha(original.expected_preview_id);validateSedimentDefinition(original.definition);
 text(body.actor,'retiring author',240);text(body.reason,'retirement reason');at(body.at);
 return atomic(workspace,()=>{const previous=oldRequest(workspace,original,'save');if(previous)return previous.result;
 const result={request_id:original.request_id,request_sha256:hash(stable(original)),abandoned:true,abandon:{actor:body.actor,at:body.at,reason:body.reason},workspace_revision:workspace.revision()};
 saveRequest(workspace,original,'save',result);workspace.event('sediment-surrogate-abandon',original.request_id,result.abandon);return result;});
}
export function sedimentStudyCatalogue(workspace){
 return workspace.readConsistent(()=>{
  const sourceMap=new Map(workspace.db.prepare("SELECT id,kind,label,sha,created_at FROM imports WHERE kind!='stations' ORDER BY created_at,id").all().map(s=>[s.id,{...s,current:true,retained_bases:[]}]));
  const studies=family(workspace,STUDY),drafts=family(workspace,DRAFT);
  for(const [kind,items] of [['study',studies],['draft',drafts]])for(const item of items){const input=kind==='study'?item.input:item.source_snapshot;if(!input)continue;for(const s of input.sources){if(!sourceMap.has(s.id))sourceMap.set(s.id,{id:s.id,kind:s.kind,label:s.label,sha:s.sha,created_at:s.created_at,current:false,retained_bases:[]});sourceMap.get(s.id).retained_bases.push({kind,id:item.id});}}
  const sources=[...sourceMap.values()];
  return {workspace_revision:workspace.revision(),workspace_identity:hash(String(workspace.directory)),sources,studies:studies.map(s=>({id:s.id,study_id:s.study_id,parent_id:s.parent_id,title:s.input.definition.title,actor:s.input.definition.actor,at:s.input.definition.at,model:s.input.definition.model,source_basis:s.input.definition.source_basis})),drafts:drafts.map(d=>({id:d.id,title:d.title,actor:d.actor,at:d.at,base_study_id:d.base_study_id})),limits:SEDIMENT_LIMITS};
 });
}
function validateProject(value){
 bound(value,SEDIMENT_LIMITS.project_bytes,'Complete sediment study project');exact(value,['format','studies','drafts','requests'],'sediment project');
 if(value.format!=='upstate.sediment-surrogate-project/v1'||!Array.isArray(value.studies)||!Array.isArray(value.drafts)||!Array.isArray(value.requests))fail('Choose a complete original sediment project');
 const studies=value.studies.map(validateStudy),drafts=value.drafts.map(checkedDraft),sm=new Map(studies.map(s=>[s.id,s])),dm=new Map(drafts.map(d=>[d.id,d]));
 if(sm.size!==studies.length||dm.size!==drafts.length)fail('Duplicate immutable scientific edition');
 for(const s of studies){let current=s;const seen=new Set();while(current){if(seen.has(current.id))fail('Cyclic study history');seen.add(current.id);if(current.parent_id){const p=sm.get(current.parent_id);if(!p||p.study_id!==s.study_id||Date.parse(p.input.definition.at)>Date.parse(current.input.definition.at))fail('Retain the complete original named-study ancestry');current=p;}else current=null;}}
 for(const d of drafts)if(d.base_study_id&&!sm.has(d.base_study_id))fail('The unfinished working basis is absent');
 for(const input of [...studies.map(s=>s.input),...drafts.map(d=>d.source_snapshot).filter(Boolean)]){
  const b=input.definition.source_basis;if(!b)continue;
  const basis=b.kind==='study'?sm.get(b.id)?.input:dm.get(b.id)?.source_snapshot;if(!basis)fail('Historical source basis is absent');
  if(input.workspace_revision!==basis.workspace_revision)fail('Historical source revision differs');
  const originals=new Map(basis.sources.map(s=>[s.id,s])),contexts=new Map(basis.contexts.map(c=>[c.id,c]));
  for(const s of input.sources)if(stable(s)!==stable(originals.get(s.id)))fail('Historical source bytes or descriptors differ');
  for(const c of input.contexts)if(stable(c)!==stable(contexts.get(c.id)))fail('Historical source review differs');
 }
 const requests=new Map(value.requests.map(q=>[q.request_id,q]));if(requests.size!==value.requests.length)fail('Duplicate original scientific request');const verified=new Set();for(const q of value.requests)checkRequest(q,sm,dm,requests,verified);
 return clone(value);
}
export function sedimentProject(workspace){return workspace.readConsistent(()=>validateProject({format:'upstate.sediment-surrogate-project/v1',studies:family(workspace,STUDY),drafts:family(workspace,DRAFT),requests:family(workspace,REQUEST)}));}
export function receiveSedimentProject(workspace,body){
 exact(body,['request_id','actor','at','note','project'],'scientific project receive');uuid(body.request_id);text(body.actor,'receiving author',240);at(body.at);text(body.note,'receiving note');
 return atomic(workspace,()=>{
  const old=oldRequest(workspace,body,'receive');if(old)return old.result;
  const project=validateProject(body.project);let added=0;
  for(const s of project.studies)added+=Number(put(workspace,s.id,STUDY,s,s.input.definition.at));
  for(const d of project.drafts)added+=Number(put(workspace,draftKey(d.id),DRAFT,d,d.at));
  for(const q of project.requests)added+=Number(put(workspace,requestKey(q.request_id),REQUEST,q,body.at));
  const result={request_id:body.request_id,request_sha256:hash(stable(body)),project_sha256:hash(stable(project)),added,workspace_revision:workspace.revision()};
  saveRequest(workspace,body,'receive',result);workspace.event('sediment-surrogate-receive',result.project_sha256,{request_id:body.request_id,actor:body.actor,at:body.at,note:body.note,added});return result;
 });
}
export function validateSedimentExports(rows){
 const items=kind=>rows.filter(r=>r.kind===kind).map(r=>JSON.parse(r.content));
 const result=validateProject({format:'upstate.sediment-surrogate-project/v1',studies:items(STUDY),drafts:items(DRAFT),requests:items(REQUEST)});
 for(const row of rows){if(![STUDY,DRAFT,REQUEST].includes(row.kind))continue;const value=JSON.parse(row.content),id=row.kind===STUDY?value.id:row.kind===DRAFT?draftKey(value.id):requestKey(value.request_id);if(row.id!==id)fail('Original sediment export row identity differs');}
 return result;
}
export function sedimentOperation(workspace,method,parts,body={}){
 if(method==='GET'&&parts.length===1){if(parts[0]==='catalogue')return sedimentStudyCatalogue(workspace);if(parts[0]==='project')return sedimentProject(workspace);}
 if(method==='GET'&&parts.length===2){if(parts[0]==='studies')return readSedimentStudy(workspace,parts[1]);if(parts[0]==='drafts')return readSedimentDraft(workspace,parts[1]);if(parts[0]==='requests')return sedimentRequest(workspace,parts[1]);}
 if(method==='POST'&&parts.length===1){if(parts[0]==='observations')return sedimentObservations(workspace,body);if(parts[0]==='deployment-preview')return previewSedimentDeployment(workspace,body);if(parts[0]==='pairs-preview')return previewSedimentPairs(workspace,body);if(parts[0]==='preview')return previewSedimentStudy(workspace,body);if(parts[0]==='save')return saveSedimentStudy(workspace,body);if(parts[0]==='drafts')return saveSedimentDraft(workspace,body);if(parts[0]==='abandon')return abandonSedimentRequest(workspace,body);if(parts[0]==='receive')return receiveSedimentProject(workspace,body);}
 fail('Sediment study operation not found',404);
}
