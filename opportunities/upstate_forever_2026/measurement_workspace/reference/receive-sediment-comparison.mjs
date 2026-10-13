/**
 * Following comparison receiving within the original sediment reference operation.
 * Borrows the same three native workspaces and original operation ownership.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {stable} from '../engine/normalise.mjs';
import {readSedimentStudy,sedimentRequest} from '../engine/sediment_workspace.mjs';
import {sedimentComparisonCandidates,previewSedimentComparison,saveSedimentComparison,readSedimentComparison,sedimentComparisonProject,receiveSedimentComparisonProject,sedimentComparisonRequest} from '../engine/sediment_comparison_workspace.mjs';
import {sedimentComparisonHTML,sedimentComparisonCSV} from '../engine/sediment_comparison_reports.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const SCHEMA='upstate.sediment-comparison-receiving/v1';
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

function workspace(w,name){
 need(w&&typeof w.directory==='string'&&['revision','readConsistent','portable'].every(k=>typeof w[k]==='function')&&w.db,'Borrow the original '+name+' MeasurementWorkspace');
 return canonicalDirectory(w.directory);
}
function exact(value,keys,label){need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'Retain exactly the original '+label+' fields');}
function planValue(value){
 const p=clone(value);exact(p,['schema','version','operationId','actor','at','reason','note','bindings','referenceDirectory','ids'],'comparison continuation plan');
 need(p.schema===SCHEMA&&p.version===1,'Use the original comparison receiving plan');
 text(p.operationId,'same original operation ID',240);text(p.actor,'comparison author',240);text(p.reason,'comparison rationale',7000);text(p.note,'receiving note',8000);
 need(typeof p.at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(p.at)&&new Date(p.at).toISOString()===p.at.replace(/Z$/,p.at.includes('.')?'Z':'.000Z'),'Retain one real UTC continuation time');
 exact(p.bindings,['author','receiver','cold'],'physical workspace bindings');
 for(const v of [...Object.values(p.bindings),p.referenceDirectory])need(typeof v==='string'&&path.isAbsolute(v)&&path.normalize(v)===v,'Use original absolute physical paths');
 need(new Set(Object.values(p.bindings)).size===3,'Keep the three original independent physical workspaces');
 const slots=['all','inRange','receive','following','coldReceive'];exact(p.ids,slots,'continuation identities');
 for(const name of slots){const id=p.ids[name],save=['all','inRange','following'].includes(name);exact(id,save?['requestId','comparisonId']:['requestId'],'original command identity');need(id.requestId===uid(p.operationId,'request:'+name),'Original request UUID differs');if(save)need(id.comparisonId===uid(p.operationId,'comparison:'+(name==='following'?'all':name)),'Original comparison name differs');}
 return p;
}
/** Pure input preparation; receive fsyncs it before the first native mutation. */
export function createSedimentComparisonReceivingPlan({operationId,actor,at,reason,note,bindings,referenceDirectory}){
 const ids={};for(const name of ['all','inRange','receive','following','coldReceive'])ids[name]={requestId:uid(operationId,'request:'+name),...(['all','inRange','following'].includes(name)?{comparisonId:uid(operationId,'comparison:'+(name==='following'?'all':name))}:{})};
 return planValue({schema:SCHEMA,version:1,operationId,actor,at,reason,note,bindings:clone(bindings),referenceDirectory,ids});
}
function files(dir){const inventory=new Map();return {
 put(name,b){const d=writeOnce(dir,name,b);inventory.set(name,d);return d;},
 json(name,value){return this.put(name,encode(value));},
 read(name){const b=bytes(path.join(dir,name));inventory.set(name,{path:name,bytes:b.length,sha256:sha(b)});return JSON.parse(b.toString('utf8'));},
 has(name){return fs.existsSync(path.join(dir,name));},
 frozen(name,make){if(this.has(name))return this.read(name);const v=make();this.json(name,v);return v;},
 all(){return [...inventory.values()].sort((a,b)=>a.path.localeCompare(b.path));}
};}

const CODE=['receive-sediment-comparison.mjs','receive-sediment-reference.mjs','sediment-reference.mjs',
 '../engine/sediment_comparison.mjs','../engine/sediment_comparison_workspace.mjs','../engine/sediment_comparison_reports.mjs',
 '../engine/sediment_workspace.mjs','../engine/sediment_pairs.mjs','../engine/sediment_surrogate.mjs',
 '../engine/workspace.mjs','../engine/normalise.mjs','../engine/characteristics.mjs','../engine/parse.mjs'];
function sourceInventory(out){
 const files=[];
 for(const relative of CODE){const b=bytes(path.resolve(HERE,relative));out.put('source--'+relative.replaceAll('../','engine-parent--').replaceAll('/','--'),b);files.push({path:relative,bytes:b.length,sha256:sha(b)});}
 out.json('loaded-source-selection.json',{schema:'upstate.sediment-comparison-receiving-source/v1',files});return files;
}
function stageRequest(out,name,make,w,call,own){
 const body=out.frozen(name+'.input.json',make);own();
 const prior=sedimentComparisonRequest(w,body.request_id);
 if(prior.committed)need(prior.request.request_sha256===sha(Buffer.from(stable(body))),'Retained request has different original command bytes');
 const result=call(w,body);out.json(name+'.result.json',result);
 const saved=sedimentComparisonRequest(w,body.request_id);need(saved.committed&&same(saved.request.result,result),'Actual original request result was not retained');
 out.json(name+'.request.json',saved);return {body,result};
}
function originalReference(selected,out){
 const dir=canonicalDirectory(selected.referenceDirectory);
 const inputBytes=bytes(path.join(dir,'command-manifest.json')),resultBytes=bytes(path.join(dir,'native-result.json'));
 const plan=JSON.parse(inputBytes.toString('utf8')),result=JSON.parse(resultBytes.toString('utf8'));
 need(plan.schema==='upstate.sediment-reference-receiving/v1'&&plan.operationId===selected.operationId&&same(plan.bindings,selected.bindings),'Select the same original scientific receiving operation and workspaces');
 need(result.schema===plan.schema&&result.operationId===selected.operationId&&result.status==='NATIVE_COMPLETE_RENDER_PENDING'&&same(result.bindings,selected.bindings),'Finish or reconcile the original native reference course before its comparison continuation');
 need(result.planSha256===sha(inputBytes),'Original reference plan hash differs');
 need(Date.parse(selected.at)>=Date.parse(plan.at),'Comparison continuation cannot predate the original reference plan');
 for(const descriptor of result.artifacts){
  need(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(descriptor.path),'Original artifact path is not a retained basename');
  const b=bytes(path.join(dir,descriptor.path));need(b.length===descriptor.bytes&&sha(b)===descriptor.sha256,'Original reference artifact changed or is absent: '+descriptor.path);
 }
 out.put('original-reference-manifest.json',inputBytes);out.put('original-reference-native-result.json',resultBytes);
 out.json('reference-binding.json',{directory:dir,operationId:plan.operationId,manifest:{bytes:inputBytes.length,sha256:sha(inputBytes)},nativeResult:{bytes:resultBytes.length,sha256:sha(resultBytes)},studies:result.studies,followingStudyId:result.followingStudyId});
 return {plan,result};
}
function selectedStudies(author,prior,out){
 const names=['temporalLogLog','temporalLinear','temporalLogLinear'],forms=['log-log','linear','log-linear'];
 const studies=names.map((name,i)=>{
  const s=readSedimentStudy(author,prior.result.studies[name]),f=s.result.fit,p=s.result.pairing;
  need(s.input.definition.study_id===prior.plan.ids[name].studyId&&f.model.form===forms[i]&&f.counts.training===68&&f.counts.validation===52&&p.rows.length===120&&p.siteId==='07144100'&&p.target==='SSC','Original temporal scientific edition differs: '+name);
  const saved=sedimentRequest(author,prior.plan.ids[name].requestId);
  need(saved.committed&&saved.request.result.study_id===s.id,'Original native save does not bind the selected scientific edition');
  return s;
 });
 out.json('selected-original-studies.json',studies);return studies;
}
function makeSelection(plan,name,studies,catalogue){
 const ranged=name==='inRange';
 return {schema:'upstate.sediment-model-comparison-selection/v1',id:plan.ids[name].comparisonId,
  title:ranged?'Common in-range comparison of three original sediment models':'Common held-out comparison of three original sediment models',
  actor:plan.actor,at:plan.at,note:plan.note,
  models:studies.map(s=>({studyId:s.id,label:s.result.fit.model.form,reason:plan.reason})),
  observations:catalogue.targets.map(row=>({targetId:row.targetId,action:'include',reason:'Retain this exact original laboratory observation in the complete later published population. '+plan.reason})),
  rangePolicy:ranged?'in-range-only':'include-flagged',
  rationale:plan.reason+' All three original candidates, including the poor-performing form, remain explicit. Comparing on this holdout consumes it for model selection; it does not independently validate the resulting choice.'};
}
function reports(edition,out,prefix){
 out.json(prefix+'.comparison.json',edition);out.put(prefix+'.report.html',sedimentComparisonHTML(edition));
 for(const kind of ['metrics','observations','coefficients'])out.put(prefix+'.'+kind+'.csv',sedimentComparisonCSV(edition,kind));
}
function exactEdition(w,e){const actual=readSedimentComparison(w,e.id);need(same(actual,e),'Original complete comparison differs after save or receive');return actual;}
function verifyProject(w,project){
 for(const s of project.sediment.studies)need(same(readSedimentStudy(w,s.id),s),'Original full scientific edition differs after receiving');
 for(const q of project.sediment.requests){const actual=sedimentRequest(w,q.request_id);need(actual.committed&&same(actual.request,q),'Original scientific request history differs after receiving');}
 for(const c of project.comparisons){const actual=readSedimentComparison(w,c.id);need(actual.document.id===c.document_id&&actual.comparison_id===c.comparison_id&&actual.parent_id===c.parent_id&&same(actual.document.input.selection,c.selection),'Original comparison recipe differs after receiving');}
 for(const q of project.requests){const actual=sedimentComparisonRequest(w,q.request_id);need(actual.committed&&same(actual.request,q),'Original comparison request history differs after receiving');}
 return {studyIds:project.sediment.studies.map(s=>s.id),comparisonIds:project.comparisons.map(c=>c.id),requestIds:project.requests.map(q=>q.request_id)};
}
/** Complete following native course. The existing caller owns all handles,
 * browser resources, and its original ownership for the entire synchronous call. */
export function receiveSedimentComparisonReference({author,receiver,cold,referenceDirectory,directory,plan,assertOwner}){
 const selected=planValue(plan);need(typeof assertOwner==='function','Borrow the original operation ownership assertion');
 const own=()=>need(assertOwner(selected.operationId)===true,'The original operation owner is not active');
 own();const bindings={author:workspace(author,'author'),receiver:workspace(receiver,'receiver'),cold:workspace(cold,'cold receiver')};
 need(same(bindings,selected.bindings)&&referenceDirectory===selected.referenceDirectory,'Continuation belongs to different physical inputs');
 const dir=canonicalDirectory(directory,true);need(dir!==selected.referenceDirectory&&!Object.values(bindings).includes(dir),'Use a distinct following output directory; preserve original native reference files and workspace paths');
 const out=files(dir);out.json('command-manifest.json',selected);const code=sourceInventory(out),prior=originalReference(selected,out);
 const studies=selectedStudies(author,prior,out),ids=studies.map(s=>s.id);
 const catalogue=out.frozen('original-common-catalogue.json',()=>sedimentComparisonCandidates(author,{study_ids:ids}));
 need(catalogue.targets.length===52,'Original held-out union differs from the complete52-sample reference');
 const editions={};
 for(const name of ['all','inRange']){
  const saved=stageRequest(out,'save-'+name,()=>{
   const selection=makeSelection(selected,name,studies,catalogue),preview=previewSedimentComparison(author,{selection,parent_id:null});
   need(preview.document.result.counts.common===(name==='all'?52:37),'Original common population differs');
   out.json('preview-'+name+'.json',preview);
   return {request_id:selected.ids[name].requestId,expected_preview_id:preview.id,selection,parent_id:null};
  },author,saveSedimentComparison,own);
  need(!saved.result.abandoned,'The original comparison request was explicitly retired; preserve that result and reconcile with the responsible author');
  const e=readSedimentComparison(author,saved.result.comparison_id);out.json('preview-'+name+'.json',e);editions[name]=e;reports(e,out,name);
 }
 const project=out.frozen('author-comparison-project.json',()=>sedimentComparisonProject(author));
 verifyProject(author,project);for(const e of Object.values(editions))need(project.comparisons.some(c=>c.id===e.id),'Complete author project omitted a selected comparison');
 out.frozen('author-whole-workspace.json',()=>author.portable());
 const received=stageRequest(out,'receive-project',()=>({request_id:selected.ids.receive.requestId,actor:selected.actor,at:selected.at,note:selected.note,project}),receiver,receiveSedimentComparisonProject,own);
 verifyProject(receiver,project);const receivedAll=exactEdition(receiver,editions.all);exactEdition(receiver,editions.inRange);
 const following=stageRequest(out,'save-following',()=>{
  const selection={...clone(receivedAll.document.input.selection),title:'Following received comparison — explicit common in-range population',actor:selected.actor,at:selected.at,note:selected.note,rangePolicy:'in-range-only',rationale:selected.reason+' Following edition of the received all-population comparison: explicitly change the scoring policy while retaining every original target and all three saved models.'};
  need(selection.id===selected.ids.following.comparisonId,'Following named comparison identity differs');
  const preview=previewSedimentComparison(receiver,{selection,parent_id:receivedAll.id});need(preview.document.result.counts.common===37&&preview.document.result.rows.length===52,'Following range choice lost original observations');
  out.json('preview-following.json',preview);
  return {request_id:selected.ids.following.requestId,expected_preview_id:preview.id,selection,parent_id:receivedAll.id};
 },receiver,saveSedimentComparison,own);
 need(!following.result.abandoned,'Original following request was retired; reconcile its exact retained outcome');
 const followingEdition=readSedimentComparison(receiver,following.result.comparison_id);out.json('preview-following.json',followingEdition);reports(followingEdition,out,'following');
 own();need(same(receiveSedimentComparisonProject(receiver,received.body),received.result),'Replayed original receive changed its first result');
 exactEdition(receiver,followingEdition);out.json('repeat-receive-preserved.json',{requestId:received.body.request_id,result:received.result,followingEditionId:followingEdition.id});
 const onward=out.frozen('following-comparison-project.json',()=>sedimentComparisonProject(receiver));verifyProject(receiver,onward);
 need(onward.comparisons.some(c=>c.id===followingEdition.id),'Following project omitted the received editable comparison');
 out.frozen('receiver-whole-workspace.json',()=>receiver.portable());
 const coldResult=stageRequest(out,'cold-receive',()=>({request_id:selected.ids.coldReceive.requestId,actor:selected.actor,at:selected.at,note:selected.note,project:onward}),cold,receiveSedimentComparisonProject,own);
 verifyProject(cold,onward);
 for(const [name,e]of Object.entries(editions))reports(exactEdition(cold,e),out,'cold-'+name);
 reports(exactEdition(cold,followingEdition),out,'cold-following');
 out.frozen('cold-whole-workspace.json',()=>cold.portable());
 const verification={schema:'upstate.sediment-comparison-cold-verification/v1',operationId:selected.operationId,projectSha256:sha(Buffer.from(stable(onward))),
  comparisons:onward.comparisons.map(c=>{const e=readSedimentComparison(cold,c.id);return {id:e.id,documentId:e.document.id,sha256:sha(encode(e))};}),
  studyIds:onward.sediment.studies.map(s=>s.id),requests:onward.requests.map(q=>({requestId:q.request_id,sha256:sha(encode(q))})),
  coldReceiveRequestId:coldResult.body.request_id,coldReceiveResult:coldResult.result};
 out.json('cold-verification.json',verification);
 const result={schema:SCHEMA,status:'NATIVE_COMPLETE_RENDER_PENDING',operationId:selected.operationId,bindings,referenceDirectory:selected.referenceDirectory,planSha256:sha(encode(selected)),source:code,
  studies:ids,comparisons:{all:editions.all.id,inRange:editions.inRange.id,following:followingEdition.id},counts:{all:editions.all.document.result.counts,inRange:editions.inRange.document.result.counts},
  receiving:{first:received.result,cold:coldResult.result},artifacts:out.all(),borrowedResources:'All original handles and operation ownership remain with the existing caller.',
  renderedInspection:'The existing owner opens and operates both policies, all reports, full source attachments, CSVs and onward exports at desktop/narrow widths; generated bytes alone are not rendered acceptance.'};
 out.json('native-result.json',result);return result;
}
/** Invoke after the original owner closes and independently reopens its cold
 * workspace. It validates retained artifacts and actual comparison history. */
export function verifySedimentComparisonColdReopen({workspace:reopened,directory,assertOwner}){
 const dir=canonicalDirectory(directory),out=files(dir),plan=planValue(out.read('command-manifest.json'));
 need(typeof assertOwner==='function'&&assertOwner(plan.operationId)===true,'Retain the original operation ownership during cold reopen');
 need(workspace(reopened,'cold reopened')===plan.bindings.cold,'Select the original cold receiving workspace');
 const project=out.read('following-comparison-project.json'),verification=out.read('cold-verification.json'),result=out.read('native-result.json');
 need(sha(Buffer.from(stable(project)))===verification.projectSha256,'Complete onward project differs');
 verifyProject(reopened,project);
 for(const d of result.artifacts){const b=bytes(path.join(dir,d.path));need(b.length===d.bytes&&sha(b)===d.sha256,'Original continuation artifact changed: '+d.path);}
 for(const d of verification.comparisons){const e=readSedimentComparison(reopened,d.id);need(e.document.id===d.documentId&&sha(encode(e))===d.sha256,'Cold complete comparison differs');}
 const request=sedimentComparisonRequest(reopened,verification.coldReceiveRequestId);need(request.committed&&same(request.request.result,verification.coldReceiveResult),'Cold receiving first result differs');
 const observed={schema:'upstate.sediment-comparison-cold-reopen/v1',status:'COLD_REOPEN_VERIFIED',operationId:plan.operationId,workspaceDirectory:reopened.directory,projectSha256:verification.projectSha256,comparisonIds:project.comparisons.map(c=>c.id),studyIds:verification.studyIds,requestIds:project.requests.map(q=>q.request_id),renderedInspection:'Actual native cold reopen; actual outgoing pages and attachments still require the original rendered-use inspection.'};
 out.json('cold-reopen-observed.json',observed);return observed;
}
