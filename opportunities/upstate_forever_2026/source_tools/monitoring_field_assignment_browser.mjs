/**
 * One browser chapter for the original retained Monitoring selection.
 * The existing receiving owner supplies its page, authenticated read-only API,
 * exact original input and durable artifact callbacks. No server/model is started.
 */
const rows=value=>Array.isArray(value)?value:[];
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(sort(value));
function sort(value){if(Array.isArray(value))return value.map(sort);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])]));return value;}
const same=(a,b)=>canonical(a)===canonical(b);
const id=value=>{if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))throw Error('Use the original retained selection identifier.');return value;};
const terminal=new Set(['complete','failed','interrupted','cancelled']);
const actionName='monitoring.field-assignment.save';
const root='.mfa';
const control=action=>root+' [data-mfa-action="'+action+'"]';
const safeName=value=>String(value).replace(/[^A-Za-z0-9_.-]/g,'_');
const ticketPath=url=>new URL(url,'http://native.invalid').pathname;
function requireValue(value,message){if(!value)throw Error(message);}
function planContent(plan){const value=clone(plan);for(const key of ['revision','updated_at','created_at'])delete value[key];return value;}

/**
 * input = {project_id, selection_record_id, title, mode:"create_or_reopen"|"inspect",
 *          edit_note?: string}. Freeze this input in the existing receiving journal.
 * api(path, query) performs authenticated GET in the original selected Workspace.
 * saveRecord(name, value), saveBytes(name, Uint8Array, originalDescriptor),
 * screenshot(page, name, width), download(locator, name, originalDescriptor),
 * readJSON(file), navigate(desk), waitFor(predicate,label,timeout), check(),
 * closeDialog() and action(name,detail) use the caller's existing durable course.
 */
export async function operateMonitoringFieldAssignment(options){
 const {page,input,workspace,api,saveRecord,saveBytes,screenshot,download,readJSON,navigate,
  waitFor,check,closeDialog,action}=options;
 requireValue(input&&typeof input.project_id==='string'&&typeof workspace==='string',
  'Keep the original project and selected Workspace in this browser course.');
 const selectionId=id(input.selection_record_id),title=String(input.title||'').trim();
 const mode=input.mode||'inspect',note=input.edit_note;
 requireValue(title&&title.length<=240,'Use the retained receiving title.');
 requireValue(['inspect','create_or_reopen'].includes(mode),'Choose inspect or create_or_reopen.');
 requireValue(note===undefined||typeof note==='string'&&note.trim()&&note.length<=2000,
  'Supply the actual receiving note, or omit the editable-note step.');
 requireValue(note===undefined||mode==='create_or_reopen','An editable-note course requires create_or_reopen.');
 const prefix='field-assignment-'+selectionId.slice(0,12);
 const get=(path,query={})=>api(path,{workspace,...query});
 const native=await get('/api/monitoring-field-assignment/selection',{id:selectionId});
 requireValue(native.selection_record_id===selectionId&&typeof native.selection_text==='string',
  'The retained selection reader returned another original.');
 const original=JSON.parse(native.selection_text);
 requireValue(original.project_id===input.project_id,'The native selection belongs to another project.');
 const initial=await get('/api/state');
 const nativeSnapshot=state=>Object.fromEntries(['sources','profiles','grids','scenarios','runs','deliveries']
  .map(kind=>[kind,rows(state.data?.[kind]).map(row=>({id:row.id,...(kind==='runs'?{state:row.state}:{})})).sort((a,b)=>a.id.localeCompare(b.id))]));
 const beforeNative=nativeSnapshot(initial);
 const preservedNative=after=>Object.entries(beforeNative).every(([kind,originals])=>originals.every(original=>rows(after[kind]).some(row=>row.id===original.id)));
 await saveRecord(prefix+'-input',{schema:'upstate.field-assignment-browser-input/v1',workspace,input,native});
 const go=async()=>{check();await closeDialog();await navigate('monitoring-field-assignment');
  await waitFor(async()=>await page.locator(root+' [name="native_selection"] option[value="'+selectionId+'"]').count()===1,'original native field selection');};
 await go();
 await page.locator(root+' [name="native_selection"]').selectOption(selectionId);
 const readResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/monitoring-field-assignment/selection'&&new URL(response.url()).searchParams.get('id')===selectionId);
 await page.locator(control('native')).click();
 const loaded=await readResponse;requireValue(loaded.ok(),'Reading the selected native field choices failed.');
 await waitFor(async()=>await page.locator(root+' [data-mfa-file]').innerText().then(text=>text.includes(selectionId.slice(0,12))&&text.includes('exact original bytes retained')),'admitted original selection bytes');
 await page.locator(root+' [name="title"]').fill(title);
 const previewResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/monitoring-field-assignment/preview'&&response.request().method()==='POST');
 await page.locator(control('preview')).click();
 const previewHTTP=await previewResponse;requireValue(previewHTTP.ok(),'The original field assignment preview failed.');
 const preview=await previewHTTP.json(),previewRequest=previewHTTP.request().postDataJSON();
 requireValue(previewRequest.selection_record_id===selectionId&&previewRequest.selection_text===native.selection_text&&
  same(previewRequest.source,native.source)&&previewRequest.title===title,'The actual preview replaced the original saved selection.');
 requireValue(preview.identity?.project_id===input.project_id&&same(preview.selection,original)&&
  preview.identity?.retained_selection?.selection_record_id===selectionId&&
  preview.identity?.retained_selection?.selection_sha256===native.selection_sha256,
  'The preview must retain the original project, record and raw selection identity.');
 const assignmentId=id(preview.id);
 await waitFor(async()=>await page.locator(control('save')).isEnabled(),'reviewed original field assignments');
 await saveRecord(prefix+'-preview',preview);
 for(const width of [1440,390])await screenshot(page,prefix+'-preview',width);
 const regions=page.locator(root+' [data-mfa-preview] [role="region"]');
 for(let n=0;n<await regions.count();n++){await regions.nth(n).focus();await page.keyboard.press('End');await page.keyboard.press('Home');}
 const catalogue=()=>get('/api/monitoring-field-assignment/catalog');
 let catalog=await catalogue(),existing=rows(catalog.assignments).find(row=>row.id===assignmentId),task=null;
 const matchingTasks=state=>rows(state.tasks).filter(row=>row.workspace===workspace&&row.action===actionName&&
  row.payload?.expected_id===assignmentId&&row.payload?.selection_record_id===selectionId);
 if(!existing){
  const state=await get('/api/state'),matches=matchingTasks(state);
  requireValue(matches.length<=1,'Reconcile the original retained assignment tasks before continuing this course.');
  task=matches[0]||null;
  if(!task&&mode==='inspect'){
   const result={schema:'upstate.field-assignment-browser/v1',state:'preview_inspected',input,assignment_id:assignmentId,selection_record_id:selectionId};
   await saveRecord(prefix+'-completion',result);return result;
  }
  if(!task){
   await page.locator(control('save')).click();await page.locator('#form-dialog').waitFor({state:'visible'});
   const acceptedResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/actions'&&response.request().method()==='POST');
   await page.locator('#form-submit').click();
   const acceptedHTTP=await acceptedResponse;requireValue(acceptedHTTP.ok(),'The native assignment action was not accepted.');
   const accepted=await acceptedHTTP.json();task=accepted.task||accepted;
   requireValue(task.id,'The accepted assignment task has no retained identity.');
   action('field_assignment_accepted',{selection_record_id:selectionId,assignment_id:assignmentId,task_id:task.id});
   await saveRecord(prefix+'-accepted-task',task);
  }
  await waitFor(async()=>{task=await get('/api/task',{id:task.id});return terminal.has(task.state);},'original field assignment task',120000);
  await saveRecord(prefix+'-task',task);
  requireValue(task.state==='complete'&&task.result?.id===assignmentId,
   'Continue the original retained task '+task.id+'; state '+task.state+'. Its full failure is saved.');
 }
 const openAssignment=async()=>{
  await go();await page.locator(control('refresh')).click();
  await waitFor(async()=>await page.locator(root+' [name="saved"] option[value="'+assignmentId+'"]').count()===1,'saved original field assignment');
  await page.locator(root+' [name="saved"]').selectOption(assignmentId);
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/monitoring-field-assignment/detail'&&new URL(response.url()).searchParams.get('id')===assignmentId);
  await page.locator(control('open')).click();const response=await responsePromise;
  requireValue(response.ok(),'The selected original assignment could not reopen.');
  const detail=await response.json();
  await waitFor(async()=>await page.locator(root+' [data-mfa-detail] h4').textContent()===detail.summary.title&&
   same(await page.locator(root+' [data-mfa-detail] a[href]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')).sort()),rows(detail._downloads).map(row=>row.url).sort()),'painted original assignment report and files');
  requireValue(detail.id===assignmentId&&detail.project_id===input.project_id&&
   detail.assignment?.identity?.retained_selection?.selection_record_id===selectionId,
   'The saved assignment changed the original selected record.');
  return detail;
 };
 let detail=await openAssignment();
 requireValue(same(detail.assignment.areas,preview.areas)&&same(detail.assignment.selected_rounds,preview.selected_rounds)&&
  detail.assignment.original_budget_usd===preview.original_budget_usd,'Saved stations, original calendar or full programme budget changed.');
 const originalReport=detail.report.id,originalPlan=clone(detail.plan),originalFiles=clone(detail.files);
 await saveRecord(prefix+'-original',detail);
 for(const width of [1440,390])await screenshot(page,prefix+'-saved',width);
 // Each visible original file is read from its native ticket and retained with exact length/SHA.
 // Inline HTML is actually opened through its displayed link; other attachments use native browser downloads.
 const tickets=rows(detail._downloads);requireValue(tickets.length>0,'The assignment has no original report/download controls.');
 const initialLinks=await page.locator(root+' [data-mfa-detail] a[href]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
 requireValue(initialLinks.length===tickets.length&&initialLinks.every(url=>tickets.some(row=>ticketPath(row.url)===ticketPath(url))),
  'The displayed assignment links differ from its original file inventory.');
 for(const ticket of tickets){
  check();detail=await openAssignment();
  const current=rows(detail._downloads).find(row=>row.label===ticket.label&&row.sha256===ticket.sha256&&row.bytes===ticket.bytes);
  requireValue(current,'An original report ticket changed while opening its files.');
  const link=page.locator(root+' [data-mfa-detail] a[href="'+current.url+'"]');
  const filename=current.filename||'',inline=/\.(html?|txt|svg|png|jpe?g|webp|pdf)$/i.test(filename);
  if(!inline){await download(link,prefix+'-'+safeName(current.label),current);continue;}
  const responsePromise=page.waitForResponse(response=>ticketPath(response.url())===ticketPath(current.url)&&response.request().isNavigationRequest());
  await link.click();const response=await responsePromise;requireValue(response.ok(),'Opening the original report file failed.');
  const bytes=await response.body();requireValue(bytes.length===current.bytes,'The opened original file length changed.');await saveBytes(prefix+'-'+current.label,bytes,current);
  if(/\.html?$/i.test(filename)){
   await page.waitForLoadState('domcontentloaded');
   requireValue((await page.locator('body').innerText()).trim().length>0,'The original report HTML is empty.');
   for(const width of [1440,390])await screenshot(page,prefix+'-report-'+safeName(current.label),width);
  }
  await page.goBack({waitUntil:'domcontentloaded'});
 }
 detail=await openAssignment();
 await page.locator(control('implementation')).click();
 const planId=detail.plan.id;
 await waitFor(async()=>await page.locator('[data-impl-change="plan"]').inputValue()===planId,'original editable Implementation plan');
 let planDetail=await get('/api/implementation/detail',{id:planId}),currentPlan=planDetail.plan;
 requireValue(currentPlan?.id===planId&&currentPlan.monitoring_field_assignment?.id===assignmentId,'The editable plan belongs to another assignment.');
 await saveRecord(prefix+'-editable-before',planDetail);
 for(const tab of ['tasks','sites','field','sources','handover']){
  await page.locator('[data-impl="tab"][data-tab="'+tab+'"]').click();
  for(const width of [1440,390])await screenshot(page,prefix+'-implementation-'+tab,width);
 }
 // A supplied review note is a planning-purpose edit. It never adds a sampled result or completed visit.
 if(note!==undefined&&!('\n'+String(currentPlan.description||'')+'\n').includes('\n'+note+'\n')){
  const before=clone(currentPlan),description=String(before.description||'')+'\n'+note;
  const pendingSaves=rows((await get('/api/state')).tasks).filter(row=>row.workspace===workspace&&row.action==='implementation.plan.save'&&row.payload?.document?.id===planId&&row.payload.document.description===description&&row.payload.expected_revision===before.revision);
  requireValue(pendingSaves.length<=1,'Reconcile the original retained plan-edit task before continuing.');
  let saveTask=pendingSaves[0]||null;
  if(!saveTask){
  await page.locator('[data-impl="settings"]').click();
  await page.locator('[data-impl-form="settings"] [name="description"]').fill(description);
  await page.locator('[data-impl-form="settings"] button[type="submit"]').click();
  await waitFor(async()=>await page.locator('.iw-dialog[open]').count()===0,'edited native plan draft');
  const acceptedResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/actions'&&response.request().method()==='POST');
  await page.locator('[data-impl="save"]').click();
  const acceptedHTTP=await acceptedResponse;requireValue(acceptedHTTP.ok(),'The original editable-plan save was not accepted.');
  const accepted=await acceptedHTTP.json();saveTask=accepted.task||accepted;
  }
  await saveRecord(prefix+'-edit-task',saveTask);
  await waitFor(async()=>{saveTask=await get('/api/task',{id:saveTask.id});return terminal.has(saveTask.state);},'original editable-plan save',120000);
  requireValue(saveTask.state==='complete','Continue the original editable-plan task '+saveTask.id+' before reopening.');
  planDetail=await get('/api/implementation/detail',{id:planId});currentPlan=planDetail.plan;
  const expected=planContent(before);expected.description=description;
  requireValue(currentPlan.revision===before.revision+1&&same(planContent(currentPlan),expected),
   'The plan revision changed more than the supplied planning-purpose note.');
  await saveRecord(prefix+'-editable-after',planDetail);
  action('field_assignment_plan_edited',{assignment_id:assignmentId,plan_id:planId,revision:currentPlan.revision});
 }
 await closeDialog();
 // Use ordinary native reopen before downloading; it also reconciles any saved local draft.
 const nativeResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/implementation/detail'&&new URL(response.url()).searchParams.get('id')===planId);
 await page.locator('[data-impl="reopen"]').click();const nativeHTTP=await nativeResponse;
 requireValue(nativeHTTP.ok()&&same((await nativeHTTP.json()).plan,currentPlan),'The native reopen returned a different current revision.');
 await waitFor(async()=>{const header=await page.locator('.iw-header .iw-muted').innerText();return await page.locator('[data-impl-change="plan"]').inputValue()===planId&&header.includes('revision '+currentPlan.revision)&&!header.includes('browser draft');},'rendered current editable plan reopened');
 const json=await download(page.locator('[data-impl="export-json"]'),prefix+'-editable-plan');
 const exported=await readJSON(json.file);
 requireValue(same(exported,currentPlan),'The exported editable plan differs from its saved native revision.');
 await page.reload({waitUntil:'domcontentloaded'});
 detail=await openAssignment();
 requireValue(detail.report.id===originalReport&&same(detail.plan,originalPlan)&&same(detail.files,originalFiles),
  'Reloading the editable project changed its original assignment/report edition.');
 await page.locator(control('implementation')).click();
 await waitFor(async()=>await page.locator('[data-impl-change="plan"]').inputValue()===planId,'same editable plan after reload');
 const reopened=await get('/api/implementation/detail',{id:planId});
 requireValue(same(reopened.plan,currentPlan),'The actual application reload changed the current editable revision.');
 for(const width of [1440,390])await screenshot(page,prefix+'-reopened',width);
 const afterNative=nativeSnapshot(await get('/api/state'));
 requireValue(preservedNative(afterNative),'An original scientific source or model run is no longer present.');
 const result={schema:'upstate.field-assignment-browser/v1',state:'complete',input,workspace,
  assignment_id:assignmentId,selection_record_id:selectionId,plan_id:planId,
  original_revision:originalPlan.revision,current_revision:currentPlan.revision,original_report_id:originalReport,
  original_file_count:tickets.length,task_id:task?.id||null,original_native:afterNative};
 await saveRecord(prefix+'-completion',result);action('field_assignment_browser_completed',result);
 return result;
}
