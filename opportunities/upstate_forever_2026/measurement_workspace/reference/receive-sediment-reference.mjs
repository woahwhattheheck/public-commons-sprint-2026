/**
 * One receiving continuation for the published USGS sediment reference.
 * Borrows three caller-owned original MeasurementWorkspace handles. Opens and
 * closes no database, browser, server, process, or separate operation owner.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareSedimentReference,importSedimentReference,buildSedimentReferenceInputs} from './sediment-reference.mjs';
import {previewSedimentStudy,saveSedimentStudy,readSedimentStudy,sedimentProject,receiveSedimentProject,sedimentRequest,sedimentStudyCatalogue} from '../engine/sediment_workspace.mjs';
import {sedimentHTML,sedimentCSV} from '../engine/sediment_reports.mjs';
import {stable} from '../engine/normalise.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SCHEMA='upstate.sediment-reference-receiving/v1';
const LIMIT=512*1024*1024;
const sha=b=>createHash('sha256').update(b).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const encode=v=>Buffer.from(JSON.stringify(v)+'\n');
function need(v,m){if(!v)throw new Error(m);}
function same(a,b){return stable(a)===stable(b);}
function uid(operation,slot){const h=sha(Buffer.from(SCHEMA+'\0'+operation+'\0'+slot)).slice(0,32).split('');h[12]='8';h[16]=(8+(parseInt(h[16],16)&3)).toString(16);const s=h.join('');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);}
function text(v,name,max=16000){need(typeof v==='string'&&v.trim()&&v.length<=max&&!v.includes('\0'),'Retain '+name+' as bounded original text');return v;}
function canonicalDirectory(v,create=false){
 need(typeof v==='string'&&path.isAbsolute(v)&&path.normalize(v)===v,'Use an absolute normalized directory');
 if(create&&!fs.existsSync(v))fs.mkdirSync(v,{mode:0o700});
 const st=fs.lstatSync(v);need(st.isDirectory()&&!st.isSymbolicLink()&&fs.realpathSync(v)===v,'Use a canonical real directory: '+v);return v;
}
function bytes(file,limit=LIMIT){
 const before=fs.lstatSync(file);need(before.isFile()&&!before.isSymbolicLink()&&before.size<=limit,'Select a bounded regular file: '+file);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const opened=fs.fstatSync(fd);need(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size,'File identity changed: '+file);const b=fs.readFileSync(fd),after=fs.fstatSync(fd);need(b.length===opened.size&&after.size===opened.size&&after.mtimeMs===opened.mtimeMs,'File changed during read: '+file);return b;}finally{fs.closeSync(fd);}
}
function syncDir(dir){const fd=fs.openSync(dir,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeOnce(dir,name,b){
 need(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name),'Artifact name must be a plain basename');
 b=Buffer.isBuffer(b)?b:Buffer.from(b);need(b.length<=LIMIT,'Retain a smaller complete operation; artifact exceeds 512 MiB');
 const file=path.join(dir,name),digest=sha(b),temp=path.join(dir,'.'+name+'.'+digest+'.partial');
 const match=p=>{const old=bytes(p);need(old.length===b.length&&sha(old)===digest,'Existing original artifact differs: '+name);};
 const settle=()=>{
  const f=fs.lstatSync(file),t=fs.existsSync(temp)?fs.lstatSync(temp):null;
  if(t&&f.dev===t.dev&&f.ino===t.ino){match(temp);syncDir(dir);fs.unlinkSync(temp);syncDir(dir);}
  need(fs.lstatSync(file).nlink===1,'Unresolved publication link: '+name);
 };
 if(fs.existsSync(file)){match(file);settle();return {path:name,bytes:b.length,sha256:digest};}
 if(fs.existsSync(temp)){
  const old=bytes(temp),stat=fs.lstatSync(temp);
  if(old.length!==b.length||sha(old)!==digest){need(stat.nlink===1&&old.length<b.length&&b.subarray(0,old.length).equals(old),'Unresolved original partial file differs: '+name);fs.unlinkSync(temp);syncDir(dir);}
 }
 if(!fs.existsSync(temp)){const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 try{fs.linkSync(temp,file);}catch(e){if(e.code!=='EEXIST')throw e;match(file);}
 syncDir(dir);settle();return {path:name,bytes:b.length,sha256:digest};
}
function workspace(w,name){need(w&&typeof w.directory==='string'&&['revision','readConsistent','record','source','import','review','portable'].every(k=>typeof w[k]==='function'),'Borrow the original '+name+' MeasurementWorkspace');return canonicalDirectory(w.directory);}
function planValue(value){
 const p=clone(value);
 need(p?.schema===SCHEMA&&p.version===1,'Use the original receiving plan');
 text(p.operationId,'existing operation ID',240);text(p.actor,'scientific author',240);text(p.reviewer,'source reviewer',240);text(p.reason,'source review rationale');text(p.note,'receiving note');
 need(typeof p.at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(p.at)&&new Date(p.at).toISOString()===p.at.replace(/Z$/,p.at.includes('.')?'Z':'.000Z'),'Retain one explicit real UTC plan time');
 need(p.applyReviews===true,'This receiving course requires explicit authorization to apply the supplied include reviews; existing include/exclude decisions remain untouched');
 need(p.sources&&Object.keys(p.sources).sort().join(',')==='csv,extraction,provenance','Retain all three complete publication sources');
 for(const [k,v]of Object.entries(p.sources))text(v,'original '+k,1024*1024);
 need(p.bindings&&Object.keys(p.bindings).sort().join(',')==='author,cold,receiver','Bind all three original physical workspaces');
 for(const v of Object.values(p.bindings))need(typeof v==='string'&&path.isAbsolute(v)&&path.normalize(v)===v,'Retain each physical workspace path');
 need(new Set(Object.values(p.bindings)).size===3,'Independent receiving requires three distinct physical workspaces');
 const slots=['calibration','temporalLogLog','temporalLinear','temporalLogLinear','following','receive','coldReceive'];
 need(p.ids&&Object.keys(p.ids).sort().join(',')===slots.sort().join(','),'Retain all original command identities');
 for(const slot of slots){need(p.ids[slot]&&p.ids[slot].requestId===uid(p.operationId,'request:'+slot),'Original request UUID differs');if(!['receive','coldReceive'].includes(slot))need(p.ids[slot].studyId===uid(p.operationId,'study:'+(slot==='following'?'temporalLogLog':slot)),'Named study identity differs');}
 return p;
}
/** Pure plan construction. The receiving entrypoint fsyncs this entire plan
 * before the first native import or review. Reuse that exact plan on reentry. */
export function createSedimentReferenceReceivingPlan({operationId,actor,reviewer,reason,at,note,bindings,sources}){
 const ids={};for(const slot of ['calibration','temporalLogLog','temporalLinear','temporalLogLinear','following','receive','coldReceive'])ids[slot]={requestId:uid(operationId,'request:'+slot),...(!['receive','coldReceive'].includes(slot)?{studyId:uid(operationId,'study:'+(slot==='following'?'temporalLogLog':slot))}:{})};
 return planValue({schema:SCHEMA,version:1,operationId,actor,reviewer,reason,at,note,applyReviews:true,bindings:clone(bindings),sources:clone(sources),ids});
}
function files(dir){const inventory=new Map();return {
 put(name,b){const d=writeOnce(dir,name,b);inventory.set(name,d);return d;},
 json(name,value){return this.put(name,encode(value));},
 read(name){const b=bytes(path.join(dir,name));inventory.set(name,{path:name,bytes:b.length,sha256:sha(b)});return JSON.parse(b.toString('utf8'));},
 has(name){return fs.existsSync(path.join(dir,name));},
 frozen(name,make){if(this.has(name))return this.read(name);const v=make();this.json(name,v);return v;},
 all(){return [...inventory.values()].sort((a,b)=>a.path.localeCompare(b.path));}
};}
const CODE=[
 'receive-sediment-reference.mjs','sediment-reference.mjs','sediment_reference_course.mjs',
 '../engine/workspace.mjs','../engine/sediment_workspace.mjs','../engine/sediment_pairs.mjs',
 '../engine/sediment_surrogate.mjs','../engine/sediment_reports.mjs','../engine/normalise.mjs',
 '../engine/characteristics.mjs','../engine/parse.mjs'
];
function sourceInventory(out){
 const selected=[];
 for(const relative of CODE){const b=bytes(path.resolve(HERE,relative));const name='source--'+relative.replaceAll('../','engine-parent--').replaceAll('/','--');out.put(name,b);selected.push({path:relative,bytes:b.length,sha256:sha(b)});}
 out.json('loaded-source-selection.json',{schema:'upstate.sediment-receiving-source/v1',files:selected});return selected;
}
function stageRequest(out,name,bodyFactory,workspace,fn,own){
 const body=out.frozen(name+'.input.json',bodyFactory);
 own();const existing=sedimentRequest(workspace,body.request_id);
 if(existing.committed)need(existing.request.request_sha256===sha(Buffer.from(stable(body))),'Committed original request belongs to different bytes');
 // Invoke the actual original API even on replay: it independently validates
 // full request/history and returns its exact first committed result.
 const result=fn(workspace,body);out.json(name+'.result.json',result);
 const saved=sedimentRequest(workspace,body.request_id);
 need(saved.committed&&same(saved.request.result,result),'Original request result was not retained');
 out.json(name+'.request.json',saved);return {body,result};
}
function snapshotReviews(author,prepared){
 return author.readConsistent(()=>({revision:author.revision(),records:prepared.reviewRequests.map(q=>{const r=author.record(q.recordId);return {recordId:r.id,review:r.review,history:r.history};})}));
}
function assertReviewPreservation(basis,current){
 const now=new Map(current.records.map(r=>[r.recordId,r]));
 for(const old of basis.records){const actual=now.get(old.recordId);need(actual,'Complete reference review population is missing');if(old.review.state!=='pending')need(same(old.review,actual.review),'An existing source-review decision changed during this course; retain both observations and reconcile before continuing');}
}
function originalFiles(study,out,prefix){
 for(let i=0;i<study.input.sources.length;i++){
  const source=study.input.sources[i];out.put(prefix+'-source-'+i+'.csv',source.content);out.json(prefix+'-source-'+i+'.metadata.json',{...source,content:undefined});
  for(let j=0;j<(source.origin.pages||[]).length;j++){const page=source.origin.pages[j];need(typeof page.text==='string'&&sha(Buffer.from(page.text))===page.sha,'Original publication attachment differs');const name=String(page.name||'source.txt').replace(/[^A-Za-z0-9._-]/g,'_');out.put(prefix+'-source-'+i+'-attachment-'+j+'-'+name,page.text);}
 }
}
function reports(study,out,prefix){
 out.json(prefix+'.study.json',study);out.put(prefix+'.report.html',sedimentHTML(study));
 for(const kind of ['pairs','residuals','predictions','coefficients'])out.put(prefix+'.'+kind+'.csv',sedimentCSV(study,kind));
 originalFiles(study,out,prefix);
}
function exactStudy(workspace,study){const actual=readSedimentStudy(workspace,study.id);need(same(actual,study),'Original scientific edition changed after save/receive');return actual;}
function verifyMembers(workspace,project){
 for(const s of project.studies)exactStudy(workspace,s);
 for(const q of project.requests){const actual=sedimentRequest(workspace,q.request_id);need(actual.committed&&same(actual.request,q),'Original request history differs after receiving');}
 return {studyIds:project.studies.map(s=>s.id),requestIds:project.requests.map(q=>q.request_id)};
}
function definition(plan,name,inputs){
 const descriptions={calibration:'All 120 published samples — calibration reproduction',temporalLogLog:'68/52 calendar holdout — log-log SSC',temporalLinear:'68/52 calendar holdout — linear SSC',temporalLogLinear:'68/52 calendar holdout — log-linear SSC'};
 const model=clone(name==='calibration'?inputs.fullModel:inputs.temporalModel);
 if(name==='temporalLinear')model.form='linear';if(name==='temporalLogLinear')model.form='log-linear';
 return {study_id:plan.ids[name].studyId,parent_id:null,title:descriptions[name],actor:plan.actor,at:plan.at,note:plan.note,selection:clone(inputs.selection),model,deployment:name==='calibration'?null:clone(inputs.deploymentSelections.flag),source_basis:null};
}
/**
 * Execute through caller-owned native handles. assertOwner must synchronously
 * return true only while the caller's original operation lease is held.
 * It is checked before each native effect. This module never acquires another
 * controller, invokes a child, closes the borrowed handles, or signals an owner.
 */
export function receiveSedimentReference({author,receiver,cold,directory,plan,assertOwner}){
 const selected=planValue(plan); // Snapshot caller input before any effect.
 need(typeof assertOwner==='function','Retain the original caller ownership assertion');
 const own=()=>need(assertOwner(selected.operationId)===true,'The original operation owner is not active');
 own();const bindings={author:workspace(author,'author'),receiver:workspace(receiver,'receiver'),cold:workspace(cold,'cold receiver')};
 need(same(bindings,selected.bindings),'The receiving plan belongs to different physical workspaces');
 const dir=canonicalDirectory(directory,true);need(!Object.values(bindings).includes(dir),'Use an operation output directory, not a workspace directory');
 const out=files(dir);out.json('command-manifest.json',selected);const code=sourceInventory(out);
 const preparation=prepareSedimentReference({...selected.sources,reviewer:selected.reviewer,reason:selected.reason});
 out.json('source-preparation.json',preparation);
 // The adapter verifies and performs the original idempotent source import.
 // Review application is deferred until its complete baseline is durable.
 own();const imported=importSedimentReference(author,preparation,{applyReviews:false});
 out.frozen('native-import-observation.json',()=>({schema:'upstate.sediment-native-import-observation/v1',result:imported,interpretation:'Actual observed original import. A duplicate indication is a source-identity observation, not an invented receipt for an interrupted earlier call.'}));
 const basis=out.frozen('source-review-basis.json',()=>snapshotReviews(author,preparation));
 if(!out.has('reviewed-native-inputs.json')){
  own();const currentBefore=snapshotReviews(author,preparation);assertReviewPreservation(basis,currentBefore);
  // This maintained helper writes only currently pending reviews through the
  // original revision-CAS API. Existing include/exclude decisions are retained.
  own();const intake=importSedimentReference(author,preparation,{applyReviews:true});
  const current=snapshotReviews(author,preparation);assertReviewPreservation(basis,current);
  if(!intake.completeSourceReview)out.frozen('source-review-required.json',()=>({basis,observed:current,actualHelperResult:intake}));
  need(intake.completeSourceReview,'Reference observations remain excluded or unresolved. Existing decisions were preserved; the scientist must inspect them before fitting.');
  out.frozen('source-review-observation.json',()=>({basis,observed:current,actualHelperResult:intake,interpretation:'Native measurement-review event history is authoritative. Applied is the count in this observed helper attempt; a retry can legitimately retain reviews committed by an earlier interrupted attempt.'}));
  need(intake.completeSourceReview,'Reference observations remain excluded or unresolved. Existing decisions were preserved; the scientist must inspect them before fitting.');
  const inputs=buildSedimentReferenceInputs(preparation,author.readConsistent(()=>preparation.reviewRequests.map(q=>author.record(q.recordId))));
  inputs.selection=clone(preparation.selection);out.json('reviewed-native-inputs.json',inputs);
 }
 out.read('source-review-observation.json');
 if(out.has('source-review-required.json'))out.read('source-review-required.json');
 const inputs=out.read('reviewed-native-inputs.json');
 need(inputs.pairing.rows.length===120,'Complete published sample population differs');
 const studies={};
 for(const name of ['calibration','temporalLogLog','temporalLinear','temporalLogLinear']){
  const saved=stageRequest(out,'save-'+name,()=>{
   const d=definition(selected,name,inputs);const preview=previewSedimentStudy(author,{definition:d});
   need(preview.result.pairing.rows.length===120,'Native preview omitted original samples');
   out.json('preview-'+name+'.json',preview);
   return {request_id:selected.ids[name].requestId,expected_revision:preview.input.workspace_revision,expected_preview_id:preview.id,definition:d};
  },author,saveSedimentStudy,own);
  const study=readSedimentStudy(author,saved.result.study_id);
  need(study.input.definition.study_id===selected.ids[name].studyId,'Named source edition identity differs');
  out.json('preview-'+name+'.json',study);
  studies[name]=study;reports(study,out,name);
 }
 const log=studies.temporalLogLog;
 need(log.result.fit.rows.filter(r=>r.role==='train').length===68&&log.result.fit.rows.filter(r=>r.role==='validate').length===52,'Explicit 2012 calendar split differs');
 need(studies.calibration.result.fit.rows.filter(r=>r.role==='train').length===120&&studies.calibration.result.fit.rows.filter(r=>r.role==='validate').length===0,'Calibration must retain all 120 samples without a held-out claim');
 // Retain both exact native deployment policies, without altering a saved fit.
 const block=out.frozen('block-policy-preview.json',()=>{
  const d=clone(log.input.definition);d.source_basis={kind:'study',id:log.id};d.deployment=clone(inputs.deploymentSelections.block);
  return previewSedimentStudy(author,{definition:d});
 });
 reports(block,out,'block-policy');
 out.json('scientific-outcomes.json',{
  calibration:studies.calibration.result.fit.statistics,
  candidates:Object.fromEntries(['temporalLogLog','temporalLinear','temporalLogLinear'].map(k=>[k,{studyId:studies[k].id,statistics:studies[k].result.fit.statistics,counts:studies[k].result.fit.counts,cohorts:studies[k].result.fit.cohorts,guidance:studies[k].result.fit.guidance}])),
  deployment:{flag:log.result.predictions,block:block.result.predictions},
  interpretation:'These are original native calculations on a historical public reference. Comparing candidates consumes the selected holdout for model selection. Sample identity is not hydrologic event independence. No automatic winner or operational approval is produced.'
 });
 const project=out.frozen('author-sediment-project.json',()=>sedimentProject(author));
 verifyMembers(author,project);for(const s of Object.values(studies))need(project.studies.some(x=>x.id===s.id),'Full original project omitted a selected scientific edition');
 out.frozen('author-whole-workspace.json',()=>author.portable());
 const received=stageRequest(out,'receive-project',()=>({request_id:selected.ids.receive.requestId,actor:selected.actor,at:selected.at,note:selected.note,project}),receiver,receiveSedimentProject,own);
 verifyMembers(receiver,project);
 const receivedLog=exactStudy(receiver,log);
 // This following edition uses the complete retained historical source. It does
 // not require those source rows to exist in the receiver's physical imports.
 const following=stageRequest(out,'save-following',()=>{
  const d={...clone(receivedLog.input.definition),parent_id:receivedLog.id,title:'Following received edition — block unsupported predictor ranges',at:selected.at,note:selected.note,source_basis:{kind:'study',id:receivedLog.id},deployment:clone(inputs.deploymentSelections.block)};
  const preview=previewSedimentStudy(receiver,{definition:d});out.json('preview-following.json',preview);
  return {request_id:selected.ids.following.requestId,expected_revision:preview.input.workspace_revision,expected_preview_id:preview.id,definition:d};
 },receiver,saveSedimentStudy,own);
 const followingStudy=readSedimentStudy(receiver,following.result.study_id);out.json('preview-following.json',followingStudy);reports(followingStudy,out,'following');
 // Repeat the exact original receive after the new edition; original request
 // replay must preserve the receiver's later independent work.
 own();need(same(receiveSedimentProject(receiver,received.body),received.result),'Original receive replay changed its first result');
 exactStudy(receiver,followingStudy);out.json('repeat-receive-preserved.json',{requestId:received.body.request_id,result:received.result,followingStudyId:followingStudy.id});
 const onward=out.frozen('following-sediment-project.json',()=>sedimentProject(receiver));
 verifyMembers(receiver,onward);need(onward.studies.some(s=>s.id===followingStudy.id),'Following export omitted the editable received edition');
 out.frozen('receiver-whole-workspace.json',()=>receiver.portable());
 const coldResult=stageRequest(out,'cold-receive',()=>({request_id:selected.ids.coldReceive.requestId,actor:selected.actor,at:selected.at,note:selected.note,project:onward}),cold,receiveSedimentProject,own);
 verifyMembers(cold,onward);
 for(const [name,s]of Object.entries(studies))reports(exactStudy(cold,s),out,'cold-'+name);
 reports(exactStudy(cold,followingStudy),out,'cold-following');
 out.frozen('cold-whole-workspace.json',()=>cold.portable());
 const verification={schema:'upstate.sediment-reference-cold-verification/v1',operationId:selected.operationId,projectSha256:sha(Buffer.from(stable(onward))),studies:onward.studies.map(s=>({id:s.id,sha256:sha(encode(s))})),requests:onward.requests.map(q=>({requestId:q.request_id,sha256:sha(encode(q))})),coldReceiveRequestId:coldResult.body.request_id,coldReceiveResult:coldResult.result};
 out.json('cold-verification.json',verification);
 const result={schema:SCHEMA,operationId:selected.operationId,status:'NATIVE_COMPLETE_RENDER_PENDING',bindings,planSha256:sha(encode(selected)),source:code,studies:Object.fromEntries(Object.entries(studies).map(([k,v])=>[k,v.id])),followingStudyId:followingStudy.id,receiving:{first:received.result,cold:coldResult.result},artifacts:out.all(),borrowedResources:'All workspace handles and the original operation lease remain with the caller.',renderedInspection:'Pending actual owner opening and operating the selected application, reports, every outgoing attachment and reopened exports at desktop and narrow widths.'};
 out.json('native-result.json',result);return result;
}
/** Call after the original owner actually closes and independently reopens its
 * cold workspace. This reads the original history and complete files only. */
export function verifySedimentReferenceColdReopen({workspace:reopened,directory,assertOwner}){
 const dir=canonicalDirectory(directory),out=files(dir),plan=planValue(out.read('command-manifest.json'));
 need(typeof assertOwner==='function'&&assertOwner(plan.operationId)===true,'Retain the original operation owner during cold reopen');
 need(workspace(reopened,'cold reopened')===plan.bindings.cold,'Reopen the original independently received physical workspace');
 const project=out.read('following-sediment-project.json'),record=out.read('cold-verification.json'),result=out.read('native-result.json');
 need(record.projectSha256===sha(Buffer.from(stable(project))),'Complete following project identity differs');
 verifyMembers(reopened,project);
 for(const d of result.artifacts){const b=bytes(path.join(dir,d.path));need(b.length===d.bytes&&sha(b)===d.sha256,'An original receiving artifact is missing or changed: '+d.path);}
 for(const s of project.studies){const expected=record.studies.find(x=>x.id===s.id);need(expected&&sha(encode(readSedimentStudy(reopened,s.id)))===expected.sha256,'Cold scientific edition differs');}
 const request=sedimentRequest(reopened,record.coldReceiveRequestId);need(request.committed&&same(request.request.result,record.coldReceiveResult),'Cold original receive result differs');
 const observed={schema:'upstate.sediment-reference-cold-reopen/v1',operationId:plan.operationId,workspaceDirectory:reopened.directory,projectSha256:record.projectSha256,studyIds:project.studies.map(s=>s.id),requestIds:project.requests.map(q=>q.request_id),status:'COLD_REOPEN_VERIFIED',renderedInspection:'This original native reopen is not a substitute for actually viewing the reports and using the browser controls.'};
 out.json('cold-reopen-observed.json',observed);return observed;
}
