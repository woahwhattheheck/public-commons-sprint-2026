// MIT. Receive the original source appraisal through the existing Research browser.
import {promises as fs,createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';

const SCHEMA='sf88-research-appraisal-browser-receiving/v1';
const CACHE='research-risk-of-bias-browser-v1';
const json=value=>JSON.stringify(value,null,2)+'\n';
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const digest=value=>createHash('sha256').update(value).digest('hex');
const stamp=()=>new Date().toISOString();
const escapeRx=value=>Array.from(String(value)).map(c=>'\\.^$*+?()[]{}|'.includes(c)?'\\'+c:c).join('');
const exact=value=>new RegExp('^'+escapeRx(value)+'$');
function need(value,message){if(!value)throw new Error(message);}
function safeName(value){need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,220}$/.test(value)&&!['.','..'].includes(value),'Unsafe receiving filename');return value;}
async function exists(file){try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function fingerprint(file){
 const stat=await fs.lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'Receiving artifact must be a regular file: '+file);
 const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){hash.update(chunk);bytes+=chunk.length;}
 return{path:file,bytes,sha256:hash.digest('hex')};
}
async function writeOnce(file,body){
 const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);await fs.mkdir(path.dirname(file),{recursive:true});
 const temporary=file+'.'+randomUUID()+'.tmp';let handle;
 try{
  handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await fs.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;const old=await fingerprint(file);need(old.bytes===bytes.length&&old.sha256===digest(bytes),'Retained receiving artifact changed: '+file);}
  return await fingerprint(file);
 }finally{await handle?.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function saveJson(file,value){
 await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(json(value));await handle.sync();await handle.close();handle=null;await fs.rename(temporary,file);const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}}
 finally{await handle?.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function publicAddress(value){const u=new URL(value),params=new URLSearchParams(u.hash.slice(1));params.delete('token');u.hash=params.toString();u.username='';u.password='';return u.href;}
async function receiveDownload(download,targetDirectory){
 const filename=safeName(download.suggestedFilename()),target=path.join(targetDirectory,filename);await fs.mkdir(targetDirectory,{recursive:true});
 const failure=await download.failure();need(!failure,'Original report download failed: '+failure);
 const stream=await download.createReadStream();need(stream,'Original report download has no byte stream');
 const temporary=target+'.'+randomUUID()+'.tmp';
 try{
  await pipeline(stream,createWriteStream(temporary,{flags:'wx',mode:0o600}));
  const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
  const incoming=await fingerprint(temporary);
  try{await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;const previous=await fingerprint(target);need(previous.bytes===incoming.bytes&&previous.sha256===incoming.sha256,'An earlier original download differs: '+target);}
  return {...await fingerprint(target),filename};
 }finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function runRiskOfBiasBrowser({
 url,dossierId,questionId,studyId,studyVersion,eligibilityReviewId,sourceCase,runDirectory,
 playwrightModule,chromiumExecutable,mode='author',selection=null,signal
}={}){
 need(['author','inspect'].includes(mode),'Choose original author or inspect receiving');
 need(typeof url==='string'&&typeof dossierId==='string'&&dossierId,'Use the original listener and dossier');
 need(path.isAbsolute(runDirectory||'')&&path.isAbsolute(playwrightModule||'')&&path.isAbsolute(chromiumExecutable||''),'Use explicit existing native browser/module and receiving paths');
 need(sourceCase&&typeof sourceCase.operationId==='string'&&sourceCase.protocol&&Array.isArray(sourceCase.reviewers),'Use the complete original source appraisal case');
 need(sourceCase.reviewers.length===2&&sourceCase.reviewers[0].actor.id!==sourceCase.reviewers[1].actor.id,'The receiving case needs both independently authored reviewer identities');
 need(sourceCase.source?.occurrenceId&&sourceCase.source?.fileName&&sourceCase.selectedResult?.resultId,'Bind the case to its existing original source and result');
 need(sourceCase.dossierId===dossierId&&sourceCase.questionId===questionId&&sourceCase.studyId===studyId&&sourceCase.studyVersion===studyVersion&&sourceCase.eligibilityReviewId===eligibilityReviewId&&/^[a-f0-9]{64}$/.test(sourceCase.studySha256||''),'The original bound case differs from its selected native dossier and study');
 const address=new URL(url);need(['http:','https:'].includes(address.protocol),'Use the original HTTP listener');
 const parameters=new URLSearchParams(address.hash.slice(1));parameters.set('dossier',dossierId);
 if(selection){parameters.set('robReview',selection.reviewId);parameters.set('robAssessment',selection.assessmentId);parameters.set('robEdition',selection.assessmentEditionId);parameters.set('robSection','comparisons');}
 address.hash=parameters.toString();
 await fs.mkdir(runDirectory,{recursive:true});const directory=await fs.realpath(runDirectory);
 need(directory===path.resolve(runDirectory),'Use the original regular receiving directory');
 const statePath=path.join(directory,'receiving-state.json'),casePath=path.join(directory,'source-case.json');
 const caseBytes=Buffer.from(json(sourceCase)),sourceCaseIdentity=await writeOnce(casePath,caseBytes);
 const identity={schema:SCHEMA,mode,operationId:sourceCase.operationId,origin:address.origin,dossierId,questionId,studyId,studyVersion,eligibilityReviewId,sourceCaseSha256:sourceCaseIdentity.sha256};
 let state=await exists(statePath)?JSON.parse(await fs.readFile(statePath,'utf8')):{schema:SCHEMA,identity,createdAt:stamp(),stages:{},selection:selection?clone(selection):{},downloads:[],screenshots:[],nativeOutputs:[],events:[]};
 need(same(state.identity,identity),'The retained original appraisal receiving input changed');
 if(selection&&Object.keys(state.selection).length)for(const key of ['reviewId','protocolId','assessmentId','assessmentEditionId'])need(state.selection[key]===selection[key],'Original received selection changed: '+key);
 const completedPath=path.join(directory,'receiving-result.json');
 if(await exists(completedPath)){
  const completed=JSON.parse(await fs.readFile(completedPath,'utf8'));
  need(['RECEIVED_ORIGINAL_APPRAISAL','AUTHORED_SOURCE_APPRAISAL'].includes(state.status)&&completed.schema===SCHEMA&&completed.mode===mode&&completed.operationId===sourceCase.operationId&&completed.dossierId===dossierId&&completed.sourceCase.sha256===sourceCaseIdentity.sha256,'The retained completed receiving result differs from this original operation');
  for(const key of ['reviewId','protocolId','assessmentId','assessmentEditionId','adjudicationId'])need(completed[key]===state.selection[key],'The completed native selection changed: '+key);
  const artifacts=[...completed.nativeOutputs,...completed.downloads,...completed.screenshots,...completed.requestFiles.flatMap(item=>[item.request,item.response]).filter(Boolean)];
  for(const artifact of artifacts){const actual=await fingerprint(artifact.path);need(actual.bytes===artifact.bytes&&actual.sha256===artifact.sha256,'The completed original receiving artifact changed: '+artifact.path);}
  return completed;
 }
 const save=async()=>{state.updatedAt=stamp();await saveJson(statePath,state);};
 const event=async(kind,detail={})=>{state.events.push({at:stamp(),kind,...detail});await save();};
 const check=()=>{if(signal?.aborted)throw signal.reason||new Error('Original appraisal receiving was cancelled');};
 await save();check();
 const loaded=await import(pathToFileURL(playwrightModule).href),chromium=loaded.chromium||loaded.default?.chromium;
 need(chromium?.launchPersistentContext,'The selected original Playwright module has no Chromium runtime');
 const profile=path.join(directory,'browser-profile');
 const browser=await chromium.launchPersistentContext(profile,{headless:true,executablePath:chromiumExecutable,viewport:{width:1360,height:900},acceptDownloads:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 let closePromise=null;const close=()=>closePromise||(closePromise=browser.close());
 const abort=()=>{close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 const captures=new Set(),pageErrors=[];
 try{
 check();const page=browser.pages()[0]||await browser.newPage();page.setDefaultTimeout(30000);
 const panel=page.locator('#view-risk-of-bias .rob-panel');
 let activeStage=null,dispatchError=null,lastHostState=null,lastView=null;
 page.on('pageerror',error=>pageErrors.push({at:stamp(),message:error.message}));
 page.on('dialog',dialog=>{if(dialog.type()==='beforeunload')dialog.accept().catch(()=>{});else dialog.dismiss().catch(()=>{});});
 page.on('response',response=>{
  const parsed=new URL(response.url());if(parsed.origin!==address.origin||response.request().method()!=='GET')return;
  if(parsed.pathname==='/api/state'){
   const pending=response.json().then(value=>{if(value&&typeof value.workspaceId==='string')lastHostState={workspaceId:value.workspaceId,instanceId:value.instanceId};}).catch(()=>{});
   captures.add(pending);pending.finally(()=>captures.delete(pending));
  }else if(parsed.pathname==='/api/dossiers/'+encodeURIComponent(dossierId)+'/risk-of-bias'){
   const pending=response.json().then(value=>{if(value?.schema==='sf88-research-risk-of-bias-view/v1'&&value.dossierId===dossierId)lastView=value;}).catch(()=>{});
   captures.add(pending);pending.finally(()=>captures.delete(pending));
  }
 });
 async function cacheRecord(requestId){
  const workspaceId=state.workspace?.workspaceId;need(workspaceId,'Original workspace observation is required before a browser request');
  return page.evaluate(async({name,workspaceId,requestId})=>{
   const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(name);q.onerror=()=>reject(q.error);q.onupgradeneeded=()=>{q.transaction.abort();reject(new Error('Original browser request store is absent'));};q.onsuccess=()=>resolve(q.result);});
   try{
    if(!db.objectStoreNames.contains('workspaceRequests'))throw new Error('The original workspace request store is absent');
    return await new Promise((resolve,reject)=>{const tx=db.transaction('workspaceRequests','readonly'),q=tx.objectStore('workspaceRequests').get([workspaceId,requestId]);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);});
   }finally{db.close();}
  },{name:CACHE,workspaceId,requestId});
 }
 async function retainReply(stage,reply,body,origin){
  const record=state.stages[stage];need(reply?.operation?.requestId===record.requestId&&reply.operation.action===record.action&&reply.dossier?.id===dossierId,'Original browser operation receipt differs');
  const acceptedPath=path.join(directory,'requests',stage,'accepted-response.json');let output;
  if(await exists(acceptedPath)){const original=JSON.parse(await fs.readFile(acceptedPath,'utf8'));need(original?.dossier?.id===dossierId&&same(original.operation,reply.operation),'Original accepted receipt changed during recovery');reply=original;output=await fingerprint(acceptedPath);}
  else output=await writeOnce(acceptedPath,body||json(reply));
  if(record.reply)need(same(record.reply.operation,reply.operation),'Original native operation changed during recovery');
  record.reply=clone(reply);record.status='COMPLETE';record.response=output;record.responseOrigin=origin;record.completedAt=record.completedAt||stamp();
  state.nativeOutputs=state.nativeOutputs.filter(value=>value.stage!==stage).concat([{stage,requestId:record.requestId,action:record.action,revision:reply.operation.revision,...output}]);await save();return reply;
 }
 await page.route(new RegExp('/api/dossiers/'+escapeRx(encodeURIComponent(dossierId))+'/risk-of-bias/reviews(?:\\?|$)'),async route=>{
  const request=route.request();if(request.method()!=='POST'){await route.continue();return;}
  let stage=activeStage;
  try{
   check();need(mode==='author'&&stage,'An unassigned native appraisal mutation was attempted');
   const body=request.postDataBuffer();need(body,'The browser did not retain an original JSON mutation');
   const input=JSON.parse(body.toString('utf8')),record=state.stages[stage];
   need(input.action===record.action&&typeof input.requestId==='string','The browser mutation differs from the current authored stage');
   if(record.requestId)need(record.requestId===input.requestId,'Recovery changed the original browser request ID');
   const envelope=await cacheRecord(input.requestId);
   need(envelope&&envelope.workspaceId===state.workspace.workspaceId&&envelope.dossierId===dossierId&&same(envelope.payload,input),'The exact originating browser request was not retained before dispatch');
   const requestFile=await writeOnce(path.join(directory,'requests',stage,'request-body.json'),body);
   const envelopePath=path.join(directory,'requests',stage,'browser-envelope.json');
   if(await exists(envelopePath)){const original=JSON.parse(await fs.readFile(envelopePath,'utf8'));need(original.workspaceId===envelope.workspaceId&&original.dossierId===envelope.dossierId&&same(original.payload,envelope.payload),'The original browser envelope changed');}
   else await writeOnce(envelopePath,json(envelope));
   record.requestId=input.requestId;record.requestFile=requestFile;record.envelopePath=envelopePath;record.status='SENDING';record.attempts=(record.attempts||0)+1;await save();
   await route.continue();
   const response=await request.response();need(response,'The original browser request has no response');const bytes=await response.body();
   const actual=await writeOnce(path.join(directory,'requests',stage,'response-attempt-'+String(record.attempts).padStart(3,'0')+'.json'),bytes);
   record.lastResponse={status:response.status(),...actual};await save();
   let reply;try{reply=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('The original native response was not complete JSON');}
   if(response.ok()){await retainReply(stage,reply,bytes,'original-browser-response');record.waiter?.resolve(reply);}
   else{record.status='REJECTED';record.error={status:response.status(),reply};await save();throw new Error('The original appraisal mutation returned HTTP '+response.status());}
  }catch(error){
   dispatchError=error;if(stage&&state.stages[stage]){const record=state.stages[stage];if(record.status!=='COMPLETE'&&record.status!=='REJECTED')record.status='UNCERTAIN';record.lastError={at:stamp(),message:error.message};await save().catch(()=>{});record.waiter?.reject(error);}
   await route.abort().catch(()=>{});
  }
 });
 const label=(scope,name)=>scope.locator('label.rob-field').filter({has:page.locator('span').filter({hasText:exact(name)})}).locator('input,textarea,select').first();
 const editor=()=>panel.locator('[data-rob="editor"] form.rob-editor');
 const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
 async function settle(){
  check();await panel.waitFor({state:'visible'});await page.waitForFunction(()=>{
   const root=document.querySelector('#view-risk-of-bias .rob-panel');if(!root)return false;
   const loader=root.querySelector('[data-rob="loading"]'),buttons=root.querySelector('[data-rob="primary-actions"]');
   return(!loader||loader.hidden)&&!!buttons?.querySelector('button')&&!buttons.querySelector('button').disabled;
  },null,{timeout:60000});check();
 }
 async function set(scope,name,value){
  check();const target=label(scope,name);await target.waitFor({state:'visible'});const tag=await target.evaluate(e=>e.tagName);
  const wanted=String(value??'');if(await target.inputValue()===wanted)return;
  if(tag==='SELECT')await target.selectOption(wanted);else await target.fill(wanted);
 }
 async function click(scope,name){check();await button(scope,name).click();check();}
 async function detailsValue(scope,title){
  const detail=scope.locator('details.rob-original').filter({has:page.locator('summary').filter({hasText:exact(title)})}).first();
  await detail.waitFor({state:'visible'});if(!await detail.evaluate(e=>e.open))await detail.locator('summary').click();
  const pre=detail.locator('pre');await pre.waitFor({state:'visible'});return JSON.parse(await pre.textContent());
 }
 async function savedView(){
  await settle();need(lastView?.dossierId===dossierId,'The original selected view was not observed');return clone(lastView);
 }
 async function navigate(section){await settle();await click(panel.locator('[data-rob="navigation"]'),section);await settle();}
 async function chooseRecord(id){
  for(let pageNumber=0;pageNumber<1000;pageNumber++){
   check();const record=panel.locator('[data-rob="records"] .rob-record').filter({has:page.locator('code.rob-id').filter({hasText:exact(id)})});
   if(await record.count()){need(await record.count()===1,'The native page contains duplicate selected IDs');await record.locator('button.rob-record-title').click();await settle();return;}
   const next=button(panel.locator('[data-rob="pagination"]'),'Next page');if(!await next.count()||await next.isDisabled())throw new Error('Original retained record absent: '+id);
   const before=lastView?.offset;await next.click();await settle();need(lastView?.offset!==before,'The original next-page cursor did not advance');
  }
  throw new Error('Original selected record page sequence exceeded its guard');
 }
 async function chooseActor(actor){
  await settle();await set(panel.locator('[data-rob="toolbar"]'),'Reviewer identity',actor.id);await settle();
 }
 async function openAssessment(actor=null){
  if(actor)await chooseActor(actor);await navigate('Assessments');await chooseRecord(state.selection.assessmentEditionId);
  const actual=await detailsValue(panel.locator('[data-rob="detail"]'),'Complete assessment target and source bindings');
  need(actual.id===state.selection.assessmentId&&actual.editionId===state.selection.assessmentEditionId,'Original assessment selection differs');
  const target=actual.target;need(target?.studyId===studyId&&target.studyVersion===studyVersion&&target.resultId===sourceCase.selectedResult.resultId&&target.resultVersion===sourceCase.selectedResult.resultVersion&&target.resultSha256===sourceCase.selectedResult.resultSha256&&target.occurrenceIds.includes(sourceCase.source.occurrenceId),'The original assessment target differs from its saved study/result/source case');return actual;
 }
 async function screenshot(name,{narrow=false,scroll=null}={}){
  check();safeName(name);const recordName=name+(narrow?'-narrow':'-desktop')+'.png',file=path.join(directory,'screenshots',recordName),old=state.screenshots.find(v=>v.name===recordName);
  if(old){const actual=await fingerprint(old.path);need(actual.bytes===old.bytes&&actual.sha256===old.sha256,'Original screenshot differs');return old;}
  await page.setViewportSize(narrow?{width:414,height:896}:{width:1360,height:900});
  if(scroll)await scroll.scrollIntoViewIfNeeded();await fs.mkdir(path.dirname(file),{recursive:true});
  need(!await exists(file),'Unrecorded screenshot already exists; reconcile its original receiving state');
  await page.screenshot({path:file,fullPage:false,animations:'disabled'});const result={name:recordName,viewport:narrow?'narrow':'desktop',revision:lastView?.revision,...await fingerprint(file)};
  state.screenshots.push(result);await save();return result;
 }
 async function recover(stage){
  const record=state.stages[stage];need(record.requestId&&record.envelopePath,'The original browser request input is absent');
  const cached=await cacheRecord(record.requestId);
  if(cached?.state==='COMPLETE'&&cached.reply)return retainReply(stage,cached.reply,null,'original-retained-browser-receipt');
  const recovery=panel.locator('[data-rob="recovery"]');const outer=recovery.locator('details').first();
  if(!await outer.evaluate(e=>e.open))await outer.locator('summary').first().click();
  let row=recovery.locator('.rob-browser-row').filter({has:page.locator('code.rob-id').filter({hasText:exact(record.requestId)})});
  if(!await row.count()){await label(recovery,'Open an original request file').setInputFiles(record.envelopePath);await settle();row=recovery.locator('.rob-browser-row').filter({has:page.locator('code.rob-id').filter({hasText:exact(record.requestId)})});}
  need(await row.count()===1,'The exact original browser request could not be reopened');
  const recoverButton=row.getByRole('button',{name:/^(Recover original request|Submit original request)$/});need(await recoverButton.count()===1,'The original browser request has a terminal rejection that requires its original correction');
  await recoverButton.click();return null;
 }
 async function perform(stage,action,author){
  check();safeName(stage);let record=state.stages[stage];
  if(record?.status==='COMPLETE'){need(record.action===action,'Original stage action changed');const raw=await fs.readFile(record.response.path);need(digest(raw)===record.response.sha256,'Original operation receipt changed');return clone(record.reply);}
  if(!record){record={action,status:'PREPARING',createdAt:stamp()};state.stages[stage]=record;await save();}
  need(record.action===action,'Original stage action changed');dispatchError=null;activeStage=stage;
  let timer;const wait=new Promise((resolve,reject)=>{Object.defineProperty(record,'waiter',{value:{resolve,reject},configurable:true,enumerable:false});timer=setTimeout(()=>reject(new Error('Original browser mutation is still awaiting its retained response')),180000);});wait.catch(()=>{});
  try{
   await settle();
   if(record.requestId){const reply=await recover(stage);if(reply)return reply;}
   else await author();
   const reply=await wait;await settle();return reply;
  }finally{clearTimeout(timer);delete record.waiter;activeStage=null;}
 }
 async function exportsForSelection(prefix){
  await settle();const before=await savedView(),completed=state.downloads.filter(v=>v.stage===prefix&&v.revision===before.revision);
  for(const format of ['json','csv','md','html']){
   check();const old=completed.find(v=>v.format===format);if(old){const actual=await fingerprint(old.path);need(actual.sha256===old.sha256&&actual.bytes===old.bytes,'Original exported report changed');continue;}
   const downloading=page.waitForEvent('download',{timeout:120000});await panel.locator('[data-rob="list-actions"] > select').selectOption(format);
   const file=await receiveDownload(await downloading,path.join(directory,'exports',prefix+'-r'+before.revision));
   state.downloads.push({stage:prefix,format,revision:before.revision,selection:clone(state.selection),...file});await save();await settle();
  }
 }

 const group=(scope,name)=>scope.getByRole('group',{name,exact:true});
 const passage=value=>({occurrenceId:value.occurrenceId,...(value.fileName?{fileName:value.fileName}:{}),locator:value.locator||'',quote:value.quote||'',jsonPointer:value.jsonPointer||'',note:value.note||''});
 async function fillPassages(scope,basis){
  const expected=(basis||[]).map(passage);
  let count=await scope.getByRole('button',{name:'Remove passage',exact:true}).count();
  while(count>expected.length){await scope.getByRole('button',{name:'Remove passage',exact:true}).last().click();count--;}
  while(count<expected.length){await click(scope,'Add source passage');count++;}
  for(let index=0;index<expected.length;index++){
   const row=group(scope,'Passage '+(index+1)),value=expected[index];
   await set(row,'Exact retained report',value.occurrenceId);
   await set(row,'Original retained filename',value.fileName||'');
   await set(row,'Page, table, field or other original locator',value.locator);
   await set(row,'Literal source passage',value.quote);
   await set(row,'JSON pointer, when applicable',value.jsonPointer);
   await set(row,'Source note',value.note);
  }
 }
 async function fillJudgment(scope,value){
  need(value&&value.judgmentId,'Use an explicitly authored configured judgment');
  const configured=sourceCase.protocol.form.judgments.find(item=>item.id===value.judgmentId);need(configured,'The authored judgment is absent from the selected protocol');
  await set(scope,'Configured reviewer judgment',value.judgmentId);
  await set(scope,'Basis for '+configured.label,value.basisStatus);
  await set(scope,'Reviewer rationale',value.rationale);
  await fillPassages(group(scope,'Supporting source passages'),value.basis);
 }
 async function fillReview(value){
  for(const domain of sourceCase.protocol.form.domains){
   const domainBox=editor().locator('section.rob-domain').filter({has:page.locator('h4').filter({hasText:exact(domain.title)})});
   need(await domainBox.count()===1,'The selected original domain is ambiguous: '+domain.id);
   for(const field of domain.fields){
    const answer=value.answers.find(item=>item.fieldId===field.id);need(answer,'The independent source appraisal omits '+field.id);
    const row=group(domainBox,field.label);await set(row,'Answer status',answer.status);
    if(answer.status==='answered'){
     if(field.type==='text')await set(row,'Authored answer',answer.value);
     else if(field.type==='choice')await set(row,'Configured answer choice',answer.value);
     else for(const choice of field.choices)await group(row,'Configured answer choices').getByRole('checkbox',{name:choice.label,exact:true}).setChecked(answer.value.includes(choice.id));
    }
    await set(row,'Answer rationale',answer.rationale);await fillPassages(group(row,'Answer source basis'),answer.basis);
   }
   const judgment=value.judgments.find(item=>item.domainId===domain.id);await fillJudgment(group(domainBox,'Domain judgment'),judgment);
  }
  await fillJudgment(group(editor(),'Overall judgment'),value.overall);
 }
 function requestedReview(value){
  return{answers:value.answers.map(answer=>({fieldId:answer.fieldId,status:answer.status,value:clone(answer.value??null),rationale:answer.rationale||'',basis:(answer.basis||[]).map(passage)})),
   judgments:value.judgments.map(judgment=>({domainId:judgment.domainId,judgmentId:judgment.judgmentId,basisStatus:judgment.basisStatus,rationale:judgment.rationale||'',basis:(judgment.basis||[]).map(passage)})),
   overall:value.overall?{judgmentId:value.overall.judgmentId,basisStatus:value.overall.basisStatus,rationale:value.overall.rationale||'',basis:(value.overall.basis||[]).map(passage)}:null};
 }
 async function verifyAuthoredReview(value){
  const actual=await detailsValue(editor(),'Complete authored operation data'),expected=requestedReview(value);
  need(same(actual.answers,expected.answers)&&same(actual.judgments,expected.judgments)&&same(actual.overall,expected.overall),'The actual form differs from the independently authored source appraisal');
  return actual;
 }
 async function originalSelector(name,id,version,sha256){
  const control=label(editor(),name),options=await control.locator('option').evaluateAll(rows=>rows.map(row=>({value:row.value,label:row.textContent})));
  const matches=options.filter(option=>{try{const value=JSON.parse(option.value);return Array.isArray(value)&&value[0]===id&&value[1]===version&&(!sha256||value[2]===sha256);}catch{return false;}});
  need(matches.length===1,'The actual retained picker has no unique exact selector: '+name);
  const tuple=JSON.parse(matches[0].value);need(typeof tuple[2]==='string'&&/^[a-f0-9]{64}$/.test(tuple[2]),'The retained picker did not expose its original record hash');
  await control.selectOption(matches[0].value);return{value:matches[0].value,id:tuple[0],version:tuple[1],sha256:tuple[2],label:matches[0].label};
 }
 async function createReview(){
  await click(panel.locator('[data-rob="primary-actions"]'),'Start appraisal review');await editor().waitFor({state:'visible'});
  await click(editor(),'Use project appraisal form');await settle();await editor().waitFor({state:'visible'});
  await set(editor(),'Reviewer / operator identifier',sourceCase.operator.id);await set(editor(),'Reviewer / operator name',sourceCase.operator.name);
  await set(editor(),'Original research question',questionId);await set(editor(),'Original eligibility review',eligibilityReviewId);
  await set(editor(),'Appraisal review name',sourceCase.review.name);await set(editor(),'Review description',sourceCase.review.description||'');
  const protocol=sourceCase.protocol;
  await set(editor(),'Protocol name',protocol.name);await set(editor(),'Protocol description and instructions',protocol.description||'');
  const instrument=group(editor(),'Selected appraisal instrument');
  for(const [labelName,value] of [['Instrument identifier',protocol.instrument.id],['Instrument title',protocol.instrument.title],['Exact instrument version',protocol.instrument.version],['Instrument origin',protocol.instrument.origin],['Appraisal scope',protocol.instrument.scope],['Original instrument source URLs',(protocol.instrument.sourceUrls||[]).join('\n')]])await set(instrument,labelName,value);
  const designs=group(instrument,'Applicable study designs'),choices=await designs.getByRole('checkbox').count();
  for(let index=0;index<choices;index++){const box=designs.getByRole('checkbox').nth(index),labelText=await box.locator('..').innerText();const nativeDesign=labelText.trim().replaceAll(' ','-');await box.setChecked(protocol.instrument.applicableDesigns.includes(nativeDesign));}
  const reviewers=group(editor(),'Independent reviewers and resolution');
  let count=await reviewers.locator('label.rob-field').filter({has:page.locator('span').filter({hasText:exact('Reviewer identifier')})}).count();
  while(count<protocol.reviewers.length){await click(reviewers,'Add named reviewer');count++;}
  while(count>protocol.reviewers.length){await reviewers.getByRole('button',{name:'Remove reviewer',exact:true}).last().click();count--;}
  for(let index=0;index<protocol.reviewers.length;index++){
   await reviewers.locator('label.rob-field').filter({has:page.locator('span').filter({hasText:exact('Reviewer identifier')})}).locator('input').nth(index).fill(protocol.reviewers[index].id);
   await reviewers.locator('label.rob-field').filter({has:page.locator('span').filter({hasText:exact('Reviewer name')})}).locator('input').nth(index).fill(protocol.reviewers[index].name);
  }
  await set(reviewers,'Minimum independent reviewers',protocol.minimumReviewers);await set(reviewers,'Resolver identifiers',protocol.resolverIds.join('\n'));await set(reviewers,'Disagreement procedure',protocol.disagreementProcedure);
  const authored=await detailsValue(editor(),'Complete authored operation data');
  need(authored.questionId===questionId&&authored.eligibilityReviewId===eligibilityReviewId&&same(authored.protocol,protocol),'The complete rendered protocol differs from the source-authored case');
  await screenshot('protocol-and-instrument',{scroll:group(editor(),'Selected appraisal instrument')});
  await click(editor(),'Save operation');
 }
 async function createAssessment(){
  await navigate('Instruments & protocols');await chooseRecord(state.selection.protocolId);
  await click(panel.locator('[data-rob="detail"]'),'Create assessment with this protocol');await editor().waitFor({state:'visible'});
  await set(editor(),'Reviewer / operator identifier',sourceCase.operator.id);await set(editor(),'Reviewer / operator name',sourceCase.operator.name);
  await set(editor(),'Assessment name',sourceCase.assessment.name);await set(editor(),'Exact protocol edition',state.selection.protocolId);
  const study=await originalSelector('Original retained study',studyId,studyVersion,sourceCase.studySha256);
  const result=await originalSelector('Original result edition',sourceCase.selectedResult.resultId,sourceCase.selectedResult.resultVersion,sourceCase.selectedResult.resultSha256);
  await set(editor(),'Applicable study design',sourceCase.assessment.design);await set(editor(),'Design rationale',sourceCase.assessment.designRationale);
  await fillPassages(group(editor(),'Evidence for the study design'),sourceCase.assessment.designBasis);
  await set(editor(),'Reason for this saved operation',sourceCase.assessment.reason);
  const record=await detailsValue(editor(),'Complete original result record');
  if(sourceCase.selectedResult.sourceRecord)need(same(record,sourceCase.selectedResult.sourceRecord),'The original displayed result differs from the selected extraction record');
  const authored=await detailsValue(editor(),'Complete authored operation data');
  need(authored.target.studyId===studyId&&authored.target.studyVersion===studyVersion&&authored.target.studySha256===study.sha256,'Actual study target differs');
  need(authored.target.resultId===result.id&&authored.target.resultVersion===result.version&&authored.target.resultSha256===result.sha256,'Actual result target differs');
  need(authored.target.occurrenceIds.includes(sourceCase.source.occurrenceId)&&same(authored.target.designBasis,(sourceCase.assessment.designBasis||[]).map(passage)),'Original design/report binding differs');
  state.sourceSelection={study,result,occurrenceIds:authored.target.occurrenceIds,source:clone(sourceCase.source)};
  const selected=await writeOnce(path.join(directory,'original-selected-result.json'),json({study,result,record,target:authored.target}));state.nativeOutputs.push({stage:'original-result-selector',...selected});await save();
  await screenshot('original-result-selection',{scroll:label(editor(),'Original result edition')});
  await screenshot('original-result-selection',{narrow:true,scroll:label(editor(),'Original result edition')});
  await page.setViewportSize({width:1360,height:900});await click(editor(),'Save operation');
 }
 async function reviewDraft(reviewer,index){
  await openAssessment(reviewer.actor);await click(panel.locator('[data-rob="detail"]'),'Open my reviewer draft');await editor().waitFor({state:'visible'});
  await fillReview(reviewer);await set(editor(),'Reason for this saved operation',reviewer.draftReason||'Record this independently authored appraisal of the exact retained source and selected result.');
  await verifyAuthoredReview(reviewer);
  if(index===0){
   const firstDomain=sourceCase.protocol.form.domains[0],firstField=firstDomain.fields[0],question=group(editor(),firstField.label);
   await screenshot('independent-appraisal-form',{scroll:question});await screenshot('independent-appraisal-form',{narrow:true,scroll:question});await page.setViewportSize({width:1360,height:900});
   const basis=group(question,'Answer source basis');await basis.getByRole('button',{name:'Inspect original report',exact:true}).first().click();
   await originalSourceScreenshot();
  }
  await click(editor(),'Save reviewer draft');
 }
 async function submitDraft(reviewer,draftId){
  await chooseActor(reviewer.actor);await navigate('Reviewer drafts');await chooseRecord(draftId);
  await click(panel.locator('[data-rob="detail"]'),'Submit this exact saved draft');await editor().waitFor({state:'visible'});
  const draft=await detailsValue(editor(),'Complete immutable draft being submitted');
  need(draft.id===draftId&&draft.actor.id===reviewer.actor.id,'The UI selected a different independent draft');
  await set(editor(),'Reason for this saved operation',reviewer.submissionReason||'Submit this exact independent source appraisal for comparison.');
  await click(editor(),'Submit this review');
 }
 async function openComparison(actor=sourceCase.adjudication.actor){
  await chooseActor(actor);await navigate('Compare & resolve');await chooseRecord(state.selection.assessmentEditionId);
  const actual=await detailsValue(panel.locator('[data-rob="detail"]'),'Exact native comparison and submission binding');
  need(actual.submissionIds.length===2&&state.selection.submissionIds.every(id=>actual.submissionIds.includes(id)),'The comparison is not bound to both original submissions');return actual;
 }
 async function adjudicate(){
  const comparison=await openComparison();
  const record=await writeOnce(path.join(directory,'original-independent-comparison.json'),json(comparison));state.nativeOutputs.push({stage:'original-independent-comparison',...record});await save();
  await screenshot('independent-comparison',{scroll:panel.locator('table.rob-review-compare')});
  await screenshot('independent-comparison',{narrow:true,scroll:panel.locator('table.rob-review-compare')});await page.setViewportSize({width:1360,height:900});
  await click(panel.locator('[data-rob="detail"]'),'Record adjudication');await editor().waitFor({state:'visible'});
  await fillReview(sourceCase.adjudication);await set(editor(),'Reason for the resolution',sourceCase.adjudication.reason);
  const authored=await verifyAuthoredReview(sourceCase.adjudication);
  need(authored.expectedComparisonSha256===comparison.sha256&&same(authored.submissionIds,comparison.submissionIds),'The resolution changed its complete original comparison binding');
  await click(editor(),'Save adjudication');
 }
 async function originalSourceScreenshot(){
  const source=panel.locator('[data-rob="sources"]');await source.waitFor({state:'visible'});
  const file=source.locator('.source-bundle-file').filter({has:page.locator('strong').filter({hasText:exact(sourceCase.source.fileName)})});
  need(await file.count()===1,'The source inspector did not expose the original named trial file');
  await click(file,'Read text');
  await source.locator('pre').filter({hasText:/NCT03529110/}).first().waitFor({state:'visible'});
  await screenshot('original-source-file',{scroll:file});await screenshot('original-source-file',{narrow:true,scroll:file});await page.setViewportSize({width:1360,height:900});
 }
  await event('original-browser-open',{address:publicAddress(address.href),profile});
  await page.goto(address.href,{waitUntil:'domcontentloaded'});await page.locator('#dossier-workspace').waitFor({state:'visible'});
  await page.locator('[data-tab="risk-of-bias"]').click();await settle();await Promise.allSettled([...captures]);
  const workspaceText=await panel.locator('[data-rob="context"] span').allTextContents(),shown=workspaceText.find(value=>value.startsWith('Workspace '));
  need(shown,'The original browser did not expose its workspace identity');
  const workspaceId=shown.slice('Workspace '.length);if(lastHostState)need(lastHostState.workspaceId===workspaceId,'Displayed and original host workspace identities differ');
  if(state.workspace)need(state.workspace.workspaceId===workspaceId,'The retained browser receiving belongs to another original workspace');
  state.workspace={workspaceId,instanceId:lastHostState?.instanceId||state.workspace?.instanceId||null};need(state.workspace.instanceId,'Original host instance identity was not observed');
  const first=await savedView();need(first.dossierId===dossierId,'The actual browser opened another dossier');
  if(state.originalRevision===undefined)state.originalRevision=first.revision;await save();
  if(mode==='author'){
   const reviewReply=await perform('01-review','create-review',createReview),reviewResult=reviewReply.operation.result;
   need(reviewResult.review?.id&&reviewResult.protocol?.id,'Original review creation omitted its protocol edition');
   state.selection.reviewId=reviewResult.review.id;state.selection.protocolId=reviewResult.protocol.id;await save();
   await set(panel.locator('[data-rob="toolbar"]'),'Appraisal review',state.selection.reviewId);await settle();
   const assessmentReply=await perform('02-assessment','create-assessment',createAssessment),assessment=assessmentReply.operation.result.assessment;
   need(assessment?.id&&assessment.editionId,'Original assessment creation omitted its immutable edition');state.selection.assessmentId=assessment.id;state.selection.assessmentEditionId=assessment.editionId;await save();
   state.selection.draftIds=state.selection.draftIds||[];state.selection.submissionIds=state.selection.submissionIds||[];
   for(let index=0;index<sourceCase.reviewers.length;index++){
    const reviewer=sourceCase.reviewers[index],letter=index===0?'a':'b';
    const draftReply=await perform('03-reviewer-'+letter+'-draft','save-draft',()=>reviewDraft(reviewer,index)),draft=draftReply.operation.result.draft;
    need(draft?.id&&draft.actor?.id===reviewer.actor.id,'Original native draft belongs to another independent reviewer');
    state.selection.draftIds[index]=draft.id;await save();
    const submissionReply=await perform('04-reviewer-'+letter+'-submission','submit-review',()=>submitDraft(reviewer,draft.id)),submission=submissionReply.operation.result.submission;
    need(submission?.id&&submission.actor?.id===reviewer.actor.id&&submission.draftId===draft.id,'Original submission did not freeze the selected reviewer draft');
    state.selection.submissionIds[index]=submission.id;await save();
   }
   const resolved=await perform('05-adjudication','adjudicate',adjudicate),adjudication=resolved.operation.result.adjudication;
   need(adjudication?.id&&adjudication.actor?.id===sourceCase.adjudication.actor.id,'Original adjudication belongs to another resolver');state.selection.adjudicationId=adjudication.id;await save();
  }else{
   need(selection?.reviewId&&selection?.assessmentEditionId&&selection?.adjudicationId&&selection?.submissionIds?.length===2,'Inspect the complete original accepted appraisal selection');
   state.selection=clone(selection);await set(panel.locator('[data-rob="toolbar"]'),'Appraisal review',selection.reviewId);await settle();
  }
  const comparison=await openComparison();
  need(comparison.adjudication?.id===state.selection.adjudicationId&&comparison.adjudicationCurrent===true,'The exact original adjudication is not current for these submitted reviews');
  state.currentRevision=(await savedView()).revision;const finalComparison=await writeOnce(path.join(directory,'final-comparison-r'+state.currentRevision+'.json'),json(comparison));state.nativeOutputs.push({stage:'final-comparison',...finalComparison});await save();
  await screenshot(mode==='inspect'?'received-adjudication':'saved-adjudication',{scroll:panel.locator('table.rob-review-compare')});
  await screenshot(mode==='inspect'?'received-adjudication':'saved-adjudication',{narrow:true,scroll:panel.locator('table.rob-review-compare')});await page.setViewportSize({width:1360,height:900});
  if(mode==='inspect'){
   await openAssessment(sourceCase.adjudication.actor);
   const sourceButton=panel.locator('[data-rob="detail"]').getByRole('button',{name:new RegExp('^Inspect .*'+escapeRx(sourceCase.source.occurrenceId))});
   need(await sourceButton.count()===1,'The received assessment has no unique original source inspection');await sourceButton.click();await originalSourceScreenshot();
   await openComparison();
  }
  await exportsForSelection(mode==='inspect'?'received-appraisal':'saved-appraisal');
  await Promise.allSettled([...captures]);need(!dispatchError,'The original browser request has an unreconciled dispatch error');
  state.currentRevision=(await savedView()).revision;state.selection.currentRevision=state.currentRevision;state.selection.originalRevision=state.originalRevision;
  state.status=mode==='inspect'?'RECEIVED_ORIGINAL_APPRAISAL':'AUTHORED_SOURCE_APPRAISAL';state.pageErrors=pageErrors;await event('original-browser-receiving-complete',{status:state.status,revision:state.currentRevision});
  const result={schema:SCHEMA,status:state.status,mode,operationId:sourceCase.operationId,workspace:state.workspace,dossierId,...state.selection,sourceSelection:state.sourceSelection||null,
   originalRevision:state.originalRevision,currentRevision:state.currentRevision,
   requestFiles:Object.entries(state.stages).map(([stage,value])=>({stage,requestId:value.requestId,action:value.action,request:value.requestFile,envelopePath:value.envelopePath,response:value.response,responseOrigin:value.responseOrigin})),
   nativeOutputs:state.nativeOutputs,downloads:state.downloads,screenshots:state.screenshots,sourceCase:sourceCaseIdentity,statePath};
  await writeOnce(path.join(directory,'receiving-result.json'),json(result));return result;
 }catch(error){
  state.status=signal?.aborted?'INTERRUPTED':'FAILED';state.lastError={at:stamp(),message:error.message};state.pageErrors=pageErrors;await save().catch(()=>{});throw error;
 }finally{
  signal?.removeEventListener('abort',abort);await Promise.allSettled([...captures]);await close();
 }
}
