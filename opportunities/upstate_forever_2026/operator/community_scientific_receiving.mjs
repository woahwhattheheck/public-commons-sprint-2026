/** Complete Community report-source and scientific receiving, inside the original course. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pair=row=>({source_collection_id:row.source_collection_id,source_id:row.source_id});
const key=row=>JSON.stringify([row.source_collection_id,row.source_id]);
const hash=/^[0-9a-f]{64}$/;
const copy=value=>JSON.parse(JSON.stringify(value));
function memberPath(value){
 assert.ok(typeof value==='string'&&value&&!value.includes('\\')&&!value.startsWith('/')&&
  !value.split('/').some(part=>!part||part==='.'||part==='..'||part.includes(':')),'Use the complete original relative member.');
 return value;
}
function selectedSources(value){
 assert.ok(value?.source&&hash.test(value.source.source_collection_id)&&value.source.source_id);
 assert.ok(value.delivery_selection?.observed_context_sources?.some(row=>key(row)===key(value.source)));
 return pair(value.source);
}

/** Borrow the original browser/task journal; never launch a second process or project. */
export function communityScientificReceiving(h){
 const {page,saved,c,api,endpoint,item,getState,checkpoint,retainedStage,retainedJSON,download,
  openReport,openCommunityTab,showTask,closeOverlays,navigate,refresh,screenshot,form,input,publicItem}=h;
 const button=action=>page.locator('[data-scientific-report-action="'+action+'"]').first();
 const timeout=c.task_timeout_seconds*1000;
 const reportDetail=id=>api(endpoint('/api/source-reports/scientific-edition',{id}));
 const draft=()=>page.evaluate(ws=>{
  const text=sessionStorage.getItem('scientific-report-draft:'+ws);return text?JSON.parse(text):null;
 },h.workspace());
 const waitDraft=async sources=>{
  await page.waitForFunction(({ws,wanted})=>{
   const value=JSON.parse(sessionStorage.getItem('scientific-report-draft:'+ws)||'null');
   return value&&!value.pending&&JSON.stringify(value.selected)===JSON.stringify(wanted);
  },{ws:h.workspace(),wanted:sources},{timeout});
  return draft();
 };
 async function scientificDesk(){
  await navigate('sources');await page.locator('[data-scientific-report-main]').waitFor();
  const recover=button('recover');
  if(await recover.isVisible()){
   await recover.click();await closeOverlays();
   await navigate('sources');
   await page.waitForFunction(()=>!document.querySelector('[data-scientific-report-action="recover"]'),null,{timeout});
  }
 }
 async function fromTask(task,action,sources){
  await showTask(task.task_id);
  await page.locator('#detail-dialog [data-action="'+action+'"][data-id="'+task.task_id+'"]').click();
  await page.locator('[data-scientific-report-main]').waitFor();
  return waitDraft(sources);
 }
 async function originalFiles(task,directory){
  await showTask(task.task_id);
  const actual=await api('/api/task?id='+task.task_id);
  assert.equal(actual.state,'complete');assert.equal(actual.workspace,h.workspace());
  assert.deepEqual(actual.payload,task.request.payload);
  const files=[];
  for(let index=0;index<(actual._downloads||[]).length;index++){
   const ticket=actual._downloads[index];
   files.push({name:ticket.filename,original:{bytes:ticket.bytes,sha256:ticket.sha256},
    ...await download(ticket,path.join(directory,String(index).padStart(3,'0')+'-'+path.basename(ticket.filename)))});
  }
  assert.ok(files.length,'Retain every original source output.');
  return files;
 }
 async function scientificFiles(id,directory,{expected=null}={}){
  await scientificDesk();
  await page.locator('[data-scientific-report-action="open"][data-id="'+id+'"]').click();
  await page.locator('[data-scientific-report-detail]:not([hidden])').waitFor();
  const value=await reportDetail(id);
  assert.equal(value.workspace_key,h.workspace());assert.equal(value.edition.id,id);
  assert.equal(value.edition.state,'complete');
  if(expected){
   assert.deepEqual(value.edition,expected.edition,'Cold receiving retains the entire original scientific edition.');
   assert.deepEqual(value.files.map(({path,role,bytes,sha256})=>({path,role,bytes,sha256})),expected.files,
    'Every scientific attachment retains its complete identity.');
  }
  const files=[];
  for(const ticket of value.files){
   memberPath(ticket.path);assert.match(ticket.sha256,hash);
   files.push({role:ticket.role,name:ticket.path,...await download(ticket,path.join(directory,ticket.path))});
  }
  assert.ok(files.some(row=>row.role==='report_pdf'),'Retain the original rendered PDF.');
  assert.ok(files.some(row=>row.role==='report_html'),'Retain the original rendered HTML.');
  assert.ok(value.viewer_url,'Open the actual saved report in its original file viewer.');
  const frame=page.frameLocator('[data-scientific-report-document-host] iframe:not([hidden])');
  await frame.locator('body').waitFor();
  const rendered=await frame.locator('body').innerText();
  assert.ok(rendered.includes('Original intervention intake and field mapping'),
   'Read the actual mapped-CSV section in the rendered scientific report.');
  for(const field of saved.revised_plan.intervention_import.field_provenance){
   if(field.source_column)assert.ok(rendered.includes(field.source_column),'Show the original mapped heading: '+field.source_column);
  }
  assert.ok(rendered.includes(saved.mapping_input.sha256),'The report must expose the exact retained CSV identity.');
  await screenshot('scientific-report-complete-desktop');
  await page.setViewportSize({width:390,height:844});
  await screenshot('scientific-report-complete-narrow');
  await page.setViewportSize({width:1440,height:1080});
  const observations={characters:rendered.length,csv_sha256:saved.mapping_input.sha256,
   fields:saved.revised_plan.intervention_import.field_provenance.map(row=>({field:row.field,source_column:row.source_column,source_column_number:row.source_column_number}))};
  if(value.archive){
   files.push({role:'complete_report_zip',name:'complete-report.zip',
    ...await download(value.archive,path.join(directory,'complete-report.zip'))});
  }
  return {edition:copy(value.edition),files:value.files.map(({path,role,bytes,sha256})=>({path,role,bytes,sha256})),
   downloads:files,rendered:observations};
 }
 async function sourceSnapshot(source,directory){
  await fs.mkdir(path.join(h.output,directory),{recursive:true,mode:0o700});
  const collection=await item('sources',source.source_collection_id);
  const entry=collection.entries.find(row=>row.id===source.source_id);assert.ok(entry);
  assert.equal(entry.kind,'document');assert.ok(entry.companions.length);
  const inventory=[entry.body,...entry.companions].map(row=>({
   name:memberPath(row.view_path||row.filename),bytes:row.bytes,sha256:row.sha256}));
  assert.equal(new Set(inventory.map(row=>row.name)).size,inventory.length);
  for(const row of inventory)assert.match(row.sha256,hash);
  return {source:pair(source),collection:publicItem(collection),inventory,
   record:await retainedJSON(path.join(directory,'complete-source.json'),publicItem(collection))};
 }
 async function handover(stageName,report,directory){
  const exported=await retainedStage(stageName('handover-export'),'community.report.handover.export',async()=>{
   await openReport(report.id);
   await page.locator('#detail-dialog [data-action="community-handover-export"]').click();
   await form().locator('[data-community-handover-export]').waitFor();
  });
  assert.equal(exported.result.report_id,report.id);
  assert.equal(exported.result.report_sha256,report.files['community-report.json'].sha256);
  assert.equal(exported.result.original_project_id,saved.project_id);
  const files=await originalFiles(exported,path.join(directory,'handover-export'));
  assert.equal(files.length,1);const archive=files[0];
  const received=await retainedStage(stageName('handover-receive'),'community.report.handover.receive',async()=>{
   await openCommunityTab('reports');
   await page.locator('[data-action="community-handover-receive"]').first().click();
   await form().locator('[name="community_handover_file"]').setInputFiles(archive.path);
   const previewPromise=page.waitForResponse(r=>r.url().includes('/api/community-report-context/handover-preview')&&r.request().method()==='GET',{timeout});
   await form().locator('[data-community-handover-review]').click();
   const response=await previewPromise,value=await response.json();assert.ok(response.ok());
   assert.equal(value.workspace_key,h.workspace());assert.equal(value.upload.sha256,archive.sha256);
   assert.equal(value.upload.bytes,archive.bytes);assert.equal(value.handover.report_id,report.id);
   assert.equal(value.handover.original_project_id,saved.project_id);
   assert.equal(value.handover.report_sha256,report.files['community-report.json'].sha256);
   assert.equal(value.handover.plan_id,saved.revised_plan.id);
   await page.locator('#form-submit').waitFor({state:'visible'});
   await page.waitForFunction(()=>!document.querySelector('#form-submit').disabled,null,{timeout});
   await screenshot('complete-source-handover-preview');
   await page.setViewportSize({width:390,height:844});await screenshot('complete-source-handover-preview-narrow');
   await page.setViewportSize({width:1440,height:1080});
   await form().locator('[name="community_handover_delivery"]').selectOption('');
  });
  assert.equal(received.request.payload.archive_sha256,archive.sha256);
  assert.equal(received.result.handover.report_id,report.id);
  assert.equal(received.result.handover.file.sha256,archive.sha256);
  assert.equal(received.result.handover.file.bytes,archive.bytes);
  assert.equal(received.result.community_report_id,report.id);
  return {exported,received,archive,received_files:await originalFiles(received,path.join(directory,'handover-received'))};
 }
 async function prepare(stageName,name,report,directory){
  const task=await retainedStage(stageName(name),'community.report.source.prepare',async()=>{
   await openReport(report.id);await page.locator('#detail-dialog [data-action="community-report-source"]').click();
   await form().locator('[name="community_report_delivery"]').selectOption('');
  });
  assert.equal(task.result.community_report_id,report.id);
  assert.equal(task.request.payload.report_sha256,report.files['community-report.json'].sha256);
  return {task,source:selectedSources(task.result),files:await originalFiles(task,directory)};
 }
 async function operate({edition,stageName,directory}){
  assert.ok(saved.mapping_original_report&&saved.mapping_input,'Continue the same complete original mapped Community case.');
  const target=path.join(directory,'scientific-report');
  await fs.mkdir(target,{recursive:true,mode:0o700});
  const original=await item('community_reports',saved.mapping_original_report.id);
  assert.deepEqual(publicItem(original),publicItem(saved.mapping_original_report));
  const revised=await item('community_reports',saved.report.id);
  assert.deepEqual(publicItem(revised),publicItem(saved.report));
  const first=await prepare(stageName,'scientific-original',original,path.join(target,'original-source'));
  const latest=await prepare(stageName,'scientific-revision',revised,path.join(target,'revised-source'));
  assert.notEqual(key(first.source),key(latest.source),'Retain both original report editions.');
  const handoff=await handover(stageName,revised,target);
  const receivedSource=selectedSources(handoff.received.result);
  const before=await sourceSnapshot(first.source,path.relative(h.output,path.join(target,'original-source')));
  const after=await sourceSnapshot(receivedSource,path.relative(h.output,path.join(target,'received-source')));
  assert.ok(after.inventory.some(row=>row.name.endsWith('received-interventions.csv')&&row.sha256===saved.mapping_input.sha256),
   'The receiving source includes the complete original mapped CSV.');
  const initialDraft=await draft();
  if(!edition.scientific_prior_draft){
   edition.scientific_prior_draft=await retainedJSON(path.relative(h.output,path.join(target,'prior-scientific-draft.json')),
    {workspace_key:h.workspace(),draft:initialDraft});await checkpoint();
  }
  const retainedRender=saved.stages[stageName('scientific-render')];
  if(retainedRender?.request&&!retainedRender.result)
   await retainedStage(stageName('scientific-render'),'source-reports.render',async()=>{throw Error('Resume the retained original render request.');},()=>{});
  await scientificDesk();
  const preserved=await draft();
  const one=await fromTask(first.task,'community-report-source-scientific',[first.source]);
  assert.deepEqual(one.contact,preserved?.contact||{name:'',organization:'',email:''});
  const composedTitle=original.title+' — original and mapped intervention source';
  await page.locator('[data-scientific-report-field="title"]').fill(composedTitle);
  const contact=copy((await draft()).contact);
  const order=[first.source,receivedSource];
  const combined=await fromTask(handoff.received,'community-report-source-append',order);
  assert.equal(combined.title,composedTitle);assert.deepEqual(combined.contact,contact);
  const repeated=await fromTask(handoff.received,'community-report-source-append',order);
  assert.deepEqual(repeated,combined,'Adding the same retained source keeps one selected edition and the entered draft.');
  await screenshot('scientific-report-ordered-originals');
  await page.setViewportSize({width:390,height:844});await screenshot('scientific-report-ordered-originals-narrow');
  await page.setViewportSize({width:1440,height:1080});
  await page.reload({waitUntil:'domcontentloaded'});await scientificDesk();
  const reopenedDraft=await waitDraft(order);
  assert.equal(reopenedDraft.title,composedTitle);assert.deepEqual(reopenedDraft.contact,contact);
  const selection={sources:order,title:composedTitle,contact};
  const previewResponse=page.waitForResponse(r=>r.url().includes('/api/source-reports/scientific-preview')&&r.request().method()==='POST',{timeout});
  await button('preview').click();
  const response=await previewResponse,preview=await response.json();assert.ok(response.ok());
  assert.equal(preview.workspace_key,h.workspace());assert.deepEqual(preview.sources.map(pair),order);
  let scientificId;
  const retained=saved.stages[stageName('scientific-render')];
  if(retained?.request||!preview.existing){
   const render=await retainedStage(stageName('scientific-render'),'source-reports.render',async()=>{},
    ()=>button('render').click());
   scientificId=render.result.scientific_report_edition_id;
   assert.deepEqual(render.request.payload,{...selection,preview_id:preview.id});
  }else{
   scientificId=preview.id;
   assert.equal((await reportDetail(scientificId)).edition.state,'complete');
  }
  assert.match(scientificId,hash);
  await scientificDesk();
  await page.locator('[data-scientific-report-action="open"][data-id="'+scientificId+'"]').click();
  await page.locator('[data-scientific-report-detail]:not([hidden])').waitFor();
  const exported=await retainedStage(stageName('scientific-export'),'source-reports.export',async()=>{},
   ()=>button('export').click());
  assert.equal(exported.result.scientific_report_edition_id,scientificId);
  const report=await scientificFiles(scientificId,path.join(target,'complete-report'));
  assert.deepEqual(report.edition.sources.map(pair),order);
  const exports=await originalFiles(exported,path.join(target,'complete-export'));
  assert.equal(exports.length,1);
  const state={
   schema:'upstate.community-scientific-receiving/v1',project_id:saved.project_id,
   original_report_id:original.id,revised_report_id:revised.id,
   original_source:before,received_source:after,revised_source:latest.source,
   handover:{archive:handoff.archive,export_task:handoff.exported.task_id,receive_task:handoff.received.task_id,
    original:copy(handoff.received.result.handover),files:handoff.received_files},
   scientific_report_id:scientificId,selection,report,archive:exports[0],
   original_prepare_task:first.task.task_id,revised_prepare_task:latest.task.task_id,
  };
  if(edition.community_scientific){
   const previous=edition.community_scientific;
   assert.equal(previous.scientific_report_id,state.scientific_report_id);
   assert.deepEqual(previous.selection,state.selection);
   assert.deepEqual(previous.report.edition,state.report.edition);
   assert.equal(previous.archive.sha256,state.archive.sha256);
  }
  edition.community_scientific=state;saved.community_scientific=state;await checkpoint();
  assert.deepEqual(publicItem(await item('community_reports',original.id)),publicItem(original));
  assert.deepEqual(publicItem(await item('community_reports',revised.id)),publicItem(revised));
  assert.deepEqual(publicItem(await item('community_plans',saved.revised_plan.id)),publicItem(saved.revised_plan));
  return state;
 }
 async function verify(){
  const expected=saved.community_scientific;assert.ok(expected,'Retain the complete original source/composer course.');
  assert.equal((await getState()).data.project.id,expected.project_id);
  for(const source of [expected.original_source,expected.received_source]){
   const actual=await item('sources',source.source.source_collection_id);
   assert.deepEqual(publicItem(actual),source.collection,'Cold receiving retains the complete original source collection.');
  }
  const stem=c.mode==='reopen'?'cold-reopened':'restored';
  const report=await scientificFiles(expected.scientific_report_id,path.join(h.output,stem+'-scientific-report'),{expected:expected.report});
  assert.deepEqual(report.edition.sources.map(pair),expected.selection.sources);
  const downloads=report.downloads;
  const retainedZIP=downloads.find(row=>row.role==='complete_report_zip');assert.ok(retainedZIP);
  assert.equal(retainedZIP.sha256,expected.archive.sha256);assert.equal(retainedZIP.bytes,expected.archive.bytes);
  await page.reload({waitUntil:'domcontentloaded'});await scientificDesk();
  await page.locator('[data-scientific-report-action="open"][data-id="'+expected.scientific_report_id+'"]').click();
  await page.locator('[data-scientific-report-document-host] iframe:not([hidden])').waitFor();
  await screenshot(stem+'-scientific-report-reloaded');
  return {scientific_report_id:expected.scientific_report_id,selection:copy(expected.selection),files:downloads};
 }
 return {operate,verify};
}
