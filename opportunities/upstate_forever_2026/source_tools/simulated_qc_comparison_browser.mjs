// Recorded walkthrough of an original retained native QC comparison.
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const running=new WeakSet();
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b)=>canonical(a)===canonical(b);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const now=()=>new Date().toISOString();
const fail=message=>{throw Object.assign(Error(message),{publicCode:'QC_COMPARISON_COURSE'});};
async function optional(path){try{return await fs.readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function immutable(path,body){
 const old=await optional(path);if(old){if(!old.equals(body))fail('A retained comparison browser member changed.');return;}
 await fs.mkdir(dirname(path),{recursive:true,mode:0o700});
 const temp=path+'.pending-'+randomUUID();let fd;
 try{fd=await fs.open(temp,'wx',0o600);await fd.writeFile(body);await fd.sync();await fd.close();fd=null;
  try{await fs.link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;const received=await fs.readFile(path);if(!received.equals(body))fail('Another comparison member occupies this retained path.');}
 }finally{if(fd)await fd.close();await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export async function runQCComparisonChapter({page,choice,operatorURL,output,checkRunning,capture,checkpoint,progress,pause}){
 if(!progress||typeof progress!=='object')fail('Use the original recorder progress object.');
 if(!page||running.has(page))fail('Use the original recorded page with one active comparison chapter.');
 for(const key of ['workspace_key','comparison_report_id','comparison_id','operation_id','field_operation_id'])if(!hex(choice?.[key]))fail('Retain the exact original comparison '+key+'.');
 if(typeof choice.plan_id!=='string'||!choice.plan_id||typeof choice.project_id!=='string')fail('Retain the original field plan and project.');
 if(typeof checkpoint!=='function'||typeof capture!=='function'||typeof checkRunning!=='function')fail('Use the original recorder callbacks.');
 const address=new URL(operatorURL),origin=address.origin,token=new URLSearchParams(address.hash.slice(1)).get('token');
 if(!['http:','https:'].includes(address.protocol)||address.username||address.password||!token)fail('Use the current original private Operator capability.');
 const redact=x=>String(x).split(String(operatorURL)).join('[private operator]').split(token).join('[private capability]').split(origin).join('[private origin]');
 const root=resolve(output),binding={...choice,operator_origin_sha256:hash(origin)},owned=new Set(),bindings=[];
 const state=progress.qc_comparison||{schema:'upstate.simulated-qc-comparison-browser/v1',binding,created_at:now(),attempts:[],files:[],screenshots:[],requests:{}};
 if(state.schema!=='upstate.simulated-qc-comparison-browser/v1'||!equal(state.binding,binding))fail('Resume the same original comparison and operator registration.');
 state.private_files=state.private_files||[];
 progress.qc_comparison=state;running.add(page);
 const attempt=state.attempts.length+1;state.attempts.push({number:attempt,started_at:now()});state.status='running';delete state.error;delete state.cleanup_errors;
 const savedViewport=page.viewportSize(),draftKey='upstate.implementation.qc-comparison/v1/'+choice.workspace_key+'/'+choice.plan_id;
 let original,baselinePlan,active=null,primary=null;
 const save=async()=>{if(state.draft&&Object.prototype.hasOwnProperty.call(state.draft,'original'))fail('Preserve the original local draft in its private recovery file before checkpointing.');state.updated_at=now();await checkpoint();};
 const stop=async()=>{await checkRunning();};
 const api=async(path,params={},body)=>{
  await stop();const response=body===undefined?await page.request.get(origin+path+'?'+new URLSearchParams(params),{headers:{Authorization:'Bearer '+token},maxRedirects:0}):await page.request.post(origin+path,{headers:{Authorization:'Bearer '+token},data:body,maxRedirects:0});
  if(!response.ok())fail('Original Operator '+path+' returned HTTP '+response.status()+'.');
  const value=await response.json();if(value.error)fail(redact(value.error.message||value.error));return value;
 };
 const retained=async(name,body,metadata={})=>{
  if(!name||isAbsolute(name)||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..'))fail('A comparison artifact path differs.');
  const path=join(root,name);await immutable(path,body);const item={path:name,bytes:body.length,sha256:hash(body),...metadata};
  const list=name.startsWith('private/')?state.private_files:state.files;
  const prior=list.find(x=>x.path===name);if(prior&&!equal(prior,item))fail('A retained comparison artifact identity changed.');
  if(!prior)list.push(item);await save();return item;
 };
 const jsonFile=(name,value)=>retained(name,Buffer.from(JSON.stringify(value,null,2)+'\n'),{kind:'native-source'});
 const readMember=async item=>{
  if(!item||typeof item.path!=='string'||isAbsolute(item.path)||item.path.includes('\\')||item.path.split('/').some(p=>!p||p==='.'||p==='..'))fail('The private recovery member path differs.');
  let path=root;
  for(const part of item.path.split('/')){path=join(path,part);if((await fs.lstat(path)).isSymbolicLink())fail('The private recovery member became an alias.');}
  if(!(await fs.stat(path)).isFile())fail('Retain the original regular recovery file.');
  const body=await fs.readFile(path);if(body.length!==item.bytes||hash(body)!==item.sha256)fail('The retained private recovery member changed.');
  return body;
 };
 const privateSnapshot=async(name,value)=>{
  if(!name.startsWith('private/qc-comparison/')||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..'))fail('Use the original private comparison recovery directory.');
  const body=Buffer.from(JSON.stringify(value,null,2)+'\n');await immutable(join(root,name),body);
  const descriptor={path:name,bytes:body.length,sha256:hash(body),kind:'private-recovery'};
  const prior=state.private_files.find(item=>item.path===name);if(prior&&!equal(prior,descriptor))fail('The private comparison recovery identity changed.');
  if(!prior)state.private_files.push(descriptor);return descriptor;
 };
 const privateDraft=async descriptor=>{
  if(!descriptor?.path?.startsWith('private/qc-comparison/'))fail('The original local draft needs its retained private file.');
  const value=JSON.parse((await readMember(descriptor)).toString('utf8'));
  if(value.key!==draftKey||value.operator_origin_sha256!==hash(origin)||(value.value!==null&&typeof value.value!=='string'))fail('The original local draft belongs to another recorded context.');
  return value.value;
 };
 const migratePrivateState=async()=>{
  // Recover only the known former private members of this exact retained course.
  const legacy=[...state.files,...state.private_files].filter(item=>/^qc-comparison\/(?:attempt-\d+\/)?(?:draft-before-recovery|native-task-(?:export|source))\.json$/.test(item.path));
  for(const old of legacy){
   const next={...old,path:'private/qc-comparison/legacy/'+old.sha256+'-'+old.path.split('/').pop(),private:true};
   let body,missing=false;
   try{body=await readMember(old);}catch(error){if(error.code!=='ENOENT')throw error;missing=true;body=await readMember(next);}
   await immutable(join(root,next.path),body);
   if(!missing){await readMember(old);await fs.unlink(join(root,old.path));}
   state.files=state.files.filter(item=>item.path!==old.path);state.private_files=state.private_files.filter(item=>item.path!==old.path);
   if(!state.private_files.some(item=>item.path===next.path))state.private_files.push(next);
  }
  if(state.draft&&Object.prototype.hasOwnProperty.call(state.draft,'original')){
   const payload={key:draftKey,operator_origin_sha256:hash(origin),value:state.draft.original};
   const reference=await privateSnapshot('private/qc-comparison/legacy-original-draft-'+hash(canonical(payload))+'.json',payload);
   delete state.draft.original;state.draft.original_file=reference;
  }
 };
 const wait=async(fn,label,seconds=60)=>{
  const until=Date.now()+seconds*1000;while(Date.now()<until){await stop();if(await fn())return;await page.waitForTimeout(150);}fail('The original comparison control did not finish: '+label);
 };
 const shot=async(label,meaning)=>{
  await stop();await page.evaluate(()=>document.fonts.ready);
  const member=await capture('qc-comparison-'+choice.comparison_id.slice(0,12)+'-a'+attempt+'-'+label,{qc_comparison:choice,meaning,producer_inspection:'required'});
  if(!state.screenshots.some(x=>x.path===member.path))state.screenshots.push(member);await save();return member;
 };
 const navigate=async(targetPage=page)=>{
  await stop();await targetPage.goto(operatorURL,{waitUntil:'domcontentloaded'});
  const selector=targetPage.locator('#workspace-select');await selector.waitFor();
  if(await selector.inputValue()!==choice.workspace_key)await selector.selectOption(choice.workspace_key);
  await wait(async()=>{const r=await api('/api/state',{workspace:choice.workspace_key,compact:'1'});return r.workspace_key===choice.workspace_key&&r.data?.project?.id===choice.project_id;},'original workspace');
  await targetPage.locator('[data-view="implementation"]').click();
  const plan=targetPage.locator('select[data-impl-change="plan"]');await plan.waitFor();await plan.selectOption(choice.plan_id);
  await targetPage.locator('[data-impl="reopen"]').click();
  await targetPage.locator('[data-impl="tab"][data-tab="field"]').click();
  await targetPage.locator('[data-impl="sample-qc"]').click();
  await targetPage.locator('.iw-qc [data-qc="compare-reviews"]').waitFor();await targetPage.locator('.iw-qc [data-qc="compare-reviews"]').click();
  await targetPage.locator('.iw-qcc [data-qcc="open"][data-report="'+choice.comparison_report_id+'"]').waitFor();
 };
 const openSaved=async(targetPage=page)=>{
  await targetPage.locator('.iw-qcc [data-qcc="open"][data-report="'+choice.comparison_report_id+'"]').click();
  await targetPage.locator('.iw-qcc [data-qcc-result]').getByText(choice.comparison_report_id,{exact:false}).waitFor();
  const body=await targetPage.locator('.iw-qcc [data-qcc-result]').innerText();
  for(const id of [original.comparison.original.before.report_id,original.comparison.original.after.report_id])if(!body.includes(id))fail('The visible comparison lost an original source report.');
 };
 const closeEditors=async()=>{if(page.isClosed())return;for(const [dialog,button]of [['.iw-qcc','[data-qcc="close"]'],['.iw-qc','[data-qc="close"]']]){if(await page.locator(dialog).count())await page.locator(dialog+' '+button).click();}};
 const restoreDraft=async()=>{
  if(!state.draft||state.draft.status==='restored')return;
  if(page.isClosed())fail('The recorded page closed; the original comparison draft remains pending for same-course recovery.');
  if(new URL(page.url()).origin!==origin)await page.goto(operatorURL,{waitUntil:'domcontentloaded'});
  await closeEditors();
  const originalValue=await privateDraft(state.draft.original_file);
  await page.evaluate(({key,value})=>{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);},{key:draftKey,value:originalValue});
  const actual=await page.evaluate(key=>localStorage.getItem(key),draftKey);if(actual!==originalValue)fail('The original comparison draft was not restored exactly.');
  state.draft.status='restored';state.draft.restored_at=now();await save();
 };
 const download=async(targetPage,label,trigger,expected,name)=>{
  await stop();let listener,timer;
  const event=new Promise((resolveDownload,reject)=>{
   listener=item=>{clearTimeout(timer);targetPage.off('download',listener);resolveDownload(item);};
   targetPage.on('download',listener);timer=setTimeout(()=>{targetPage.off('download',listener);reject(Error('The original comparison download did not start.'));},30000);
  });event.catch(()=>{});
  try{
   await trigger();const item=await event;await stop();
   const temp=join(root,'.qc-comparison-download-'+randomUUID());await fs.mkdir(root,{recursive:true,mode:0o700});
   try{await item.saveAs(temp);const error=await item.failure();if(error)fail('The original comparison download failed: '+redact(error));const bytes=await fs.readFile(temp);
    if(expected&&(bytes.length!==expected.bytes||hash(bytes)!==expected.sha256))fail('The downloaded original comparison source changed.');
    return await retained(name,bytes,{kind:label,suggested_filename:item.suggestedFilename()});
   }finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }finally{clearTimeout(timer);targetPage.off('download',listener);}
 };
 const verifyTask=(task,entry)=>{
  if(task.workspace!==choice.workspace_key||task.action!==entry.request.action||!equal(task.payload,entry.request.payload)||!hex(task.id)||!task.operation_id||task.id!==hash(canonical({workspace:task.workspace,operation_id:task.operation_id}))||task.request_sha256!==hash(canonical({workspace:task.workspace,action:task.action,payload:task.payload})))fail('The native comparison task differs from its original request.');
  if(entry.id&&(entry.id!==task.id||entry.accepted_operation_id!==task.operation_id))fail('The accepted native comparison task identity changed.');
  entry.id=task.id;entry.accepted_operation_id=task.operation_id;entry.state=task.state;return task;
 };
 const routePattern=/\/api\/actions(?:\?|$)/,routeHandler=async route=>{
  try{const request=route.request(),body=request.postDataJSON();if(new URL(request.url()).origin!==origin||!active||active.dispatched||body.workspace!==choice.workspace_key||body.action!==active.action||!equal(body.payload,active.payload)||!body.operation_id)fail('This chapter only queues the selected original comparison export or source.');
   const entry={request:body,prepared_at:now(),state:'prepared'};state.requests[active.key]=entry;active.dispatched=true;await save();await route.continue();
  }catch(e){if(active)active.error=e;await route.abort('failed');}
 };
 const queued=async(key,operation,button)=>{
  const action='implementation.qc.comparison.'+operation,payload={plan_id:choice.plan_id,comparison_report_id:choice.comparison_report_id};
  let entry=state.requests[key];
  if(!entry){
   active={key,action,payload,dispatched:false,error:null};
   try{await page.locator('.iw-qcc [data-qcc="'+button+'"]').click();await wait(()=>Boolean(state.requests[key])||Boolean(active.error),'retained original request');if(active.error)throw active.error;entry=state.requests[key];}
   finally{active=null;}
  }
  if(entry.request.action!==action||!equal(entry.request.payload,payload))fail('The retained comparison request changed.');
  if(!entry.id){const returned=await api('/api/actions',{},entry.request);verifyTask(returned.task||returned,entry);await save();}
  const until=Date.now()+900000;
  let task;
  while(Date.now()<until){
   const response=await api('/api/task',{id:entry.id});task=verifyTask(response.task||response,entry);await save();
   if(task.state==='complete')break;
   if(task.state==='interrupted'){await api('/api/task/resume',{}, {id:task.id});}
   else if(['failed','cancelled'].includes(task.state))fail('The original comparison task '+task.state+': '+redact(task.error?.message||'Inspect its retained task.'));
   await page.waitForTimeout(500);
  }
  if(task?.state!=='complete')fail('Resume this original comparison export/source task: '+entry.id);
  if(task.result?.comparison_report_id!==choice.comparison_report_id||task.result?.comparison_id!==choice.comparison_id)fail('The completed task returned another comparison.');
  await jsonFile('private/qc-comparison/attempt-'+attempt+'/native-task-'+key+'.json',task);
  // Restore only this exact retained task into the original editor after an interrupted response.
  // Its normal start()/poll() then receives the decorated native result and clears pending state.
  await page.locator('.iw-qcc [data-qcc="close"]').click();
  await page.evaluate(({key,request,id,accepted})=>{
   const value=JSON.parse(localStorage.getItem(key)||'null');if(!value?.selection)throw Error('The original comparison draft is missing.');
   value.pending={action:request.action,payload:request.payload,operation_id:request.operation_id,id,accepted_operation_id:accepted,state:'complete'};
   localStorage.setItem(key,JSON.stringify(value));
  },{key:draftKey,request:entry.request,id:entry.id,accepted:entry.accepted_operation_id});
  await page.locator('.iw-qc [data-qc="compare-reviews"]').click();
  await wait(()=>page.evaluate(key=>{const v=JSON.parse(localStorage.getItem(key)||'null');return v?.pending===null;},draftKey),'native comparison completion',90);
  await page.locator('.iw-qcc [data-qcc-result]').getByText(choice.comparison_report_id,{exact:false}).waitFor();
  return task;
 };
 try{
  await stop();await migratePrivateState();await save();await page.setViewportSize({width:1440,height:1000});
  await page.goto(operatorURL,{waitUntil:'domcontentloaded'});
  if(state.draft?.status==='restore_required'){
   const current=await page.evaluate(key=>localStorage.getItem(key),draftKey);
   await jsonFile('private/qc-comparison/attempt-'+attempt+'/draft-before-recovery.json',{key:draftKey,value:current});await restoreDraft();
  }
  const draft=await page.evaluate(key=>localStorage.getItem(key),draftKey);
  const draftFile=await privateSnapshot('private/qc-comparison/attempt-'+attempt+'/original-draft.json',{key:draftKey,operator_origin_sha256:hash(origin),value:draft});
  state.draft={key:draftKey,original_file:draftFile,status:'restore_required',captured_at:now()};await save();
  // Preserve an existing human draft/pending task privately, then use a separate temporary local selection.
  await page.evaluate(key=>localStorage.removeItem(key),draftKey);
  original=await api('/api/implementation-qc/comparison-inspect',{workspace:choice.workspace_key,plan_id:choice.plan_id,comparison_report_id:choice.comparison_report_id});
  if(original.comparison_id!==choice.comparison_id||original.plan_id!==choice.plan_id)fail('The original comparison identity differs.');
  const project=await api('/api/state',{workspace:choice.workspace_key,compact:'1'});
  if(project.data?.project?.id!==choice.project_id)fail('The comparison belongs to another original scientific project.');
  const rawPlan=await api('/api/implementation/detail',{workspace:choice.workspace_key,id:choice.plan_id});baselinePlan=rawPlan.plan||rawPlan.document;
  const context={comparison:original.comparison,files:original.files,plan_sha256:hash(canonical(baselinePlan))};
  if(state.source&&!equal(state.source,context))fail('The original comparison or current field plan changed during this recorded edition.');
  state.source=context;await save();await jsonFile('qc-comparison/native-comparison.json',context);
  await page.route(routePattern,routeHandler);bindings.push([page,routePattern,routeHandler]);
  await navigate();await openSaved();await shot('saved','Original comparison, original before/after IDs and complete source context');
  await page.locator('.iw-qcc input[name="filter"]').fill('no-such-original-pair-'+randomUUID());
  await wait(()=>page.locator('.iw-qcc [data-qcc-result]').innerText().then(t=>t.includes('0 matching pairs')),'empty original-pair filter');await shot('empty-filter','Real empty filter of the retained pair catalogue');
  await page.locator('.iw-qcc input[name="filter"]').fill('');await shot('unfiltered','All original pair rows restored');
  const selection=original.comparison.selection;
  await page.locator('.iw-qcc select[name="selection.before_report_id"]').selectOption(selection.before_report_id);
  await page.locator('.iw-qcc select[name="selection.after_report_id"]').selectOption(selection.after_report_id);
  await page.locator('.iw-qcc [data-qcc="load"]').click();
  await wait(()=>page.locator('.iw-qcc select[name="pair.before_group_id"] option[value="'+selection.pairs[0].before_group_id+'"]').count(),'original group choices');
  for(const name of ['title','reviewer','as_of','purpose','notes'])await page.locator('.iw-qcc [name="selection.'+name+'"]').fill(String(selection[name]||''));
  for(const pair of selection.pairs){
   await page.locator('.iw-qcc select[name="pair.before_group_id"]').selectOption(pair.before_group_id);
   await page.locator('.iw-qcc select[name="pair.after_group_id"]').selectOption(pair.after_group_id);
   await page.locator('.iw-qcc textarea[name="pair.basis"]').fill(pair.basis);
   await page.locator('.iw-qcc textarea[name="pair.notes"]').fill(pair.notes||'');
   await page.locator('.iw-qcc [data-qcc="add"]').click();
  }
  await page.locator('.iw-qcc [data-qcc="preview"]').click();
  await page.locator('.iw-qcc [data-qcc="preview-json"]').waitFor();
  const preview=await download(page,'native-ui-preview',()=>page.locator('.iw-qcc [data-qcc="preview-json"]').click(),null,'qc-comparison/attempt-'+attempt+'/ui-preview.json');
  const calculated=JSON.parse(await fs.readFile(join(root,preview.path),'utf8'));
  const pairBodies=value=>value.pairs.map(({id,...r})=>r);
  if(!equal(pairBodies(calculated),pairBodies(original.comparison)))fail('The authored original pairing preview differs from the saved native comparison.');
  await shot('explicit-pairs','Actual before/after chooser, original groups and authored relationship bases');
  await page.setViewportSize({width:390,height:844});await shot('narrow','Actual narrow comparison selection and original paired outcome cards');await page.setViewportSize({width:1440,height:1000});
  await openSaved();
  const exportTask=await queued('export','export','export');await shot('export-complete','Original native complete-package export finished in the field desk');
  const sourceTask=await queued('source','source','source');await shot('source-complete','Original comparison scientific source retained through the native queue');
  if(!sourceTask.result.report_source)fail('The original scientific-source task returned no source identity.');
  state.report_source=sourceTask.result.report_source;
  // Keep the native source action's current rendered download list, including both unchanged original review ZIPs.
  const downloads=sourceTask._downloads||[];
  const expectedFiles=new Map(original.files.map(item=>[item.path.split('/').pop(),item]));
  if(downloads.length!==expectedFiles.size||new Set(downloads.map(item=>item.filename||item.name)).size!==downloads.length)fail('The original complete report download list is incomplete or repeated.');
  for(const item of downloads){const expected=expectedFiles.get(item.filename||item.name);if(!expected||expected.bytes!==item.bytes||expected.sha256!==item.sha256)fail('The original source download inventory differs.');}
  await page.locator('.iw-qcc [data-qcc-result] details').evaluate(el=>{el.open=true;});
  for(const item of downloads){
   const name=item.filename||item.name;if(typeof name!=='string'||!name||name!==name.split('/').pop()||name.includes('\\')||name==='.'||name==='..')fail('A native report download has another filename.');
   const link=page.locator('.iw-qcc [data-qcc-result]').getByRole('link',{name,exact:true});
   await download(page,'original-report-member',()=>link.click(),item,'qc-comparison/report/'+name);
  }
  const archive=(exportTask._downloads||[]).find(x=>(x.filename||x.name||'').endsWith('.zip')&&x.sha256===exportTask.result.archive?.sha256);
  if(!archive)fail('The original complete comparison ZIP ticket is missing.');
  await closeEditors();
  await page.locator('[data-action="tasks"]').click();await page.locator('[data-action="task-open"][data-id="'+exportTask.id+'"]').click();
  const zipLink=page.locator('#detail-body .file-row').filter({hasText:archive.sha256}).filter({hasText:archive.filename||archive.name}).getByRole('link',{name:'Download',exact:true});
  await download(page,'complete-native-package',()=>zipLink.click(),archive,'qc-comparison/complete-source-package.zip');
  await page.locator('#detail-dialog [data-action="detail-close"]').click();
  const browser=page.context().browser();if(!browser)fail('The original recorder has no Browser for independent receiving.');
  const received=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});owned.add(received);
  const fresh=await received.newPage();await navigate(fresh);await openSaved(fresh);
  const receivedBody=await fresh.locator('.iw-qcc [data-qcc-result]').innerText();if(!receivedBody.includes(choice.comparison_report_id))fail('The independent browser did not reopen the exact original comparison.');
  await retained('qc-comparison/attempt-'+attempt+'/fresh-native-comparison.png',await fresh.screenshot({fullPage:true}),{kind:'actual-rendered-screenshot',producer_inspection:'required'});
  await fresh.goto(pathToFileURL(join(root,'qc-comparison/report/report.html')).href,{waitUntil:'load'});
  if(!(await fresh.locator('body').innerText()).includes(original.comparison.title))fail('The exported original comparison HTML did not reopen.');
  await retained('qc-comparison/attempt-'+attempt+'/fresh-offline-report.png',await fresh.screenshot({fullPage:true}),{kind:'actual-rendered-screenshot',producer_inspection:'required'});
  // The parent's capture callback intentionally captures its recorded page.
  await page.goto(pathToFileURL(join(root,'qc-comparison/report/report.html')).href,{waitUntil:'load'});
  await shot('offline-report','Actual downloaded complete comparison HTML, all source links retained in its directory');
  await page.setViewportSize({width:390,height:844});await shot('offline-report-narrow','Downloaded comparison report at narrow width');await page.setViewportSize({width:1440,height:1000});
  await page.goto(operatorURL,{waitUntil:'domcontentloaded'});
  const after=await api('/api/implementation/detail',{workspace:choice.workspace_key,id:choice.plan_id});
  if(!equal(after.plan||after.document,baselinePlan))fail('The comparison browser course changed the original field plan.');
  state.status='course_complete';state.completed_at=now();Object.assign(state.attempts.at(-1),{status:'course_complete',completed_at:state.completed_at});state.visual_review={status:'producer_inspection_required',instruction:'Open and look at the actual outgoing screenshots and downloaded/reopened products; operate important controls and repair visible faults.'};await save();
  if(pause)await pause(250);
  return {status:state.status,...choice,files:state.files,screenshots:state.screenshots,task_ids:Object.values(state.requests).map(r=>r.id),report_source:state.report_source,visual_review:state.visual_review};
 }catch(error){
  primary=error;state.status='interrupted';state.error=redact(error.message||error);Object.assign(state.attempts.at(-1),{status:'interrupted',ended_at:now(),error:state.error});await save().catch(()=>{});error.message=redact(error.message||error);throw error;
 }finally{
  const errors=[];
  try{await restoreDraft();if(!page.isClosed()&&savedViewport)await page.setViewportSize(savedViewport);}catch(e){errors.push(redact(e.message||e));}
  for(const [p,pattern,handler]of bindings)if(!p.isClosed())try{await p.unroute(pattern,handler);}catch(e){errors.push(redact(e.message||e));}
  for(const context of owned)try{await context.close();}catch(e){errors.push(redact(e.message||e));}
  if(errors.length){state.status='interrupted';state.cleanup_errors=errors;Object.assign(state.attempts.at(-1),{status:'interrupted',ended_at:now(),cleanup_errors:errors});await save().catch(()=>{});}
  running.delete(page);
  if(errors.length&&!primary)fail('Complete original comparison browser recovery: '+errors.join('; '));
 }
}
