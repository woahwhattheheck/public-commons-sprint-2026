// TJ Labs / GridKind — complete measured-source operating and cold receiving chapter.
// The existing owner supplies both live pages and retains its original process lease.
// This module never launches or closes a server, context, browser or solver.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {sha,json,need,same,readJSON,exists,keep,verifyFile,intent,context,ensureAuthoredWeek} from './energy-cli.mjs';
import {energySourceInput,previewEnergySource,reviewEnergy,inspectEnergyReview,energyDigest} from './energy-source.mjs';
const APP=path.dirname(fileURLToPath(import.meta.url));
const inside=(root,value)=>value===root||value.startsWith(root+path.sep);
async function api(page,route,body){
 const base=new URL(page.url()).origin;need(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Use the original loopback application.');
 const r=body?await page.request.post(base+route,{data:body,headers:{Origin:base},timeout:120000}):await page.request.get(base+route,{timeout:120000});
 const raw=await r.body();let v;try{v=JSON.parse(raw);}catch{throw Error('Unreadable original API response.');}
 need(r.ok()&&!v.error,v.error||'Original HTTP '+r.status());return v;
}
async function idle(page){await page.waitForFunction(()=>document.querySelector('#reload')&&!document.querySelector('#reload').disabled);}
async function open(page,origin){await page.goto(origin+'/energy',{waitUntil:'domcontentloaded'});await page.locator('#working-label').waitFor();await idle(page);}
async function download(page,root,name,click){
 const event=page.waitForEvent('download',{timeout:120000});await click();const d=await event,temporary=path.join(root,'.download-'+randomUUID());await fs.mkdir(root,{recursive:true});
 try{await d.saveAs(temporary);return await keep(root,name,await fs.readFile(temporary));}finally{await fs.rm(temporary,{force:true});}
}
async function snapshot(page,root,name){
 if(await exists(path.join(root,name)))return keep(root,name,await fs.readFile(path.join(root,name)));
 return keep(root,name,await page.screenshot({fullPage:true}));
}
async function working(page,root,name){
 if(await exists(path.join(root,name)))return keep(root,name,await fs.readFile(path.join(root,name)));
 return download(page,root,name,()=>page.locator('#download-working').click());
}
async function selectSaved(page,kind,id){
 const sel=page.locator('#'+kind+'-select');
 for(;;){
  if(await sel.locator('option').evaluateAll((nodes,id)=>nodes.some(n=>n.value===id),id)){await sel.selectOption(id);return;}
  const next=page.locator('#'+kind+'-next');need(!await next.isDisabled(),'The selected original '+kind+' record is absent.');await next.click();await idle(page);
 }
}
async function response(page,button,action){
 const observed=page.waitForResponse(r=>{try{return new URL(r.url()).pathname==='/api/energy'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action===action;}catch{return false;}},{timeout:120000});
 await page.locator(button).click();const r=await observed,v=await r.json();need(r.ok()&&!v.error,v.error||'Original source preview failed.');await idle(page);return v;
}
async function resume(page,origin,root,phase,home,expectedIntent){
 const body=await readJSON(path.join(root,phase+'_Request.json'));need(same(intent(body),expectedIntent)&&body.context.householdId===home,'Retained course request differs.');
 const pending=path.join(root,phase+'_Pending_Working.json');
 if(!await exists(pending)){
  const before=await readJSON(path.join(root,phase+'_Before_Working.json'));
  need(before.schema==='gridkind-energy-working/v1'&&before.householdId===home&&!before.pending,'Complete pre-dispatch work is required for original recovery.');
  before.pending={body,intentSha256:energyDigest(intent(body)),attempts:[]};await keep(root,phase+'_Pending_Working.json',json(before));
 }
 const w=await readJSON(pending);need(w.pending?.body?.requestId===body.requestId&&same(w.pending.body,body),'Pending working file differs from its original captured request.');
 await open(page,origin);await page.locator('#open-working').setInputFiles(pending);await idle(page);
 await page.locator('#resume').click();await idle(page);
 const found=await api(page,'/api/energy/outcome?householdId='+home+'&requestId='+body.requestId);
 need(found.record?.detail?.requestSha256===energyDigest(expectedIntent),'The original request has no matching saved outcome. Its pending file remains available.');
 need(await page.locator('#pending').isHidden(),'The page has not reconciled its exact pending outcome.');
 await keep(root,phase+'_Record.json',json(found.record));return found.record;
}
async function saveThroughUI(page,origin,root,phase,home,expectedIntent,button,{loseResponse=false}={}){
 if(await exists(path.join(root,phase+'_Request.json')))return resume(page,origin,root,phase,home,expectedIntent);
 await working(page,root,phase+'_Before_Working.json');
 let done,failure=null,selected=null,result=null;const settled=new Promise(resolve=>{done=resolve;});
 const handler=async route=>{
  let matched=false;
  try{
   const b=route.request().postDataJSON();if(b?.action!==expectedIntent.action){await route.continue();return;}matched=true;
   need(!selected,'The same operating phase attempted a second mutation.');need(b.context.householdId===home&&same(intent(b),expectedIntent),'The UI request differs from the selected original source or week.');
   selected=b;await keep(root,phase+'_Request.json',json(b));
   const pending=await working(page,root,phase+'_Pending_Working.json'),w=JSON.parse(await verifyFile(pending));
   need(w.pending?.body?.requestId===b.requestId&&same(w.pending.body,b),'The browser did not retain the original request before dispatch.');
   const r=await route.fetch({timeout:120000}),raw=await r.body();await keep(root,phase+'_Response.json',raw);const v=JSON.parse(raw);
   need(r.ok()&&!v.error,v.error||'Original save failed.');need(v.record?.detail?.requestId===b.requestId&&v.record.detail.requestSha256===energyDigest(expectedIntent),'Native response differs from the captured intent.');
   result=v.record;await keep(root,phase+'_Record.json',json(result));
   if(loseResponse)await route.abort('failed');else await route.fulfill({response:r});
  }catch(e){failure=e;try{await route.abort('failed');}catch{}}
  finally{if(matched||failure)done();}
 };
 await page.route('**/api/energy',handler);let timer;
 try{
  await page.locator(button).click();await Promise.race([settled,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original response remains unresolved. Retain the captured pending request.')),250000);})]);
  if(failure)throw failure;need(result,'No complete original saved record returned.');await idle(page);
  if(loseResponse){need(await page.locator('#release').isHidden(),'An uncertain response must not permit a new corrected request.');return resume(page,origin,root,phase,home,expectedIntent);}
  return result;
 }finally{clearTimeout(timer);await page.unroute('**/api/energy',handler);}
}
async function exported(page,root,record,source,week){
 const binding={record:record.sha256,source:source.sha256,week:week.sha256};
 const doneFile=path.join(root,'result.json');
 if(await exists(doneFile)){const prior=await readJSON(doneFile);need(same(prior.binding,binding),'Completed browser chapter selects another source.');for(const d of prior.artifacts)await verifyFile(d);return prior.artifacts;}
 await selectSaved(page,'review',record.id);await page.locator('#load-review').click();await idle(page);
 need((await page.locator('#saved-view').innerText()).includes(record.detail.review.title),'The actual saved review is not visible.');
 const formats=[['Original CSV','Original_Intervals.csv','source'],['All original row references','All_Source_Rows.csv','rows'],['Complete source and saved record','Complete_Record.json','json'],['Readable HTML report','Energy_Review.html','html'],['All review hours','All_168_Hours.csv','csv']];
 const descriptors=[];
 for(const[label,name,format]of formats){
  const target=path.join(root,name);let d;
  if(await exists(target))d=await keep(root,name,await fs.readFile(target));else d=await download(page,root,name,()=>page.getByRole('link',{name:label,exact:true}).click());
  const route=page.locator('#downloads a').filter({hasText:label});const href=await route.getAttribute('href'),r=await page.request.get(new URL(href,page.url()).href);need(r.ok(),'Original export unavailable.');need((await r.body()).equals(await verifyFile(d)),'Browser download differs from its current original export.');descriptors.push(d);
  if(format==='source')need((await verifyFile(d)).equals(Buffer.from(source.detail.edition.source.csv)),'Original interval bytes changed.');
  if(format==='json'){const value=JSON.parse(await verifyFile(d));need(same(value.record,record)&&same(value.source,source)&&same(value.week,week),'Full exported source/record identities differ.');}
 }
 for(const[width,height,name]of [[1440,1000,'Review_Desktop.png'],[390,844,'Review_Phone.png']]){
  await page.setViewportSize({width,height});descriptors.push(await snapshot(page,root,name));if(!await exists(path.join(root,name+'.txt')))await keep(root,name+'.txt',Buffer.from(await page.locator('body').innerText()));
 }
 // Inspect the literal downloaded report and every actual text attachment using one owned page.
 const inspect=await page.context().newPage();
 try{
  const html=await fs.readFile(path.join(root,'Energy_Review.html'),'utf8');await inspect.setContent(html,{waitUntil:'load'});
  need((await inspect.locator('body').innerText()).includes(record.detail.review.title),'Downloaded readable report title is absent.');
  for(const[width,height,name]of [[1440,1000,'Downloaded_Report_Desktop.png'],[390,844,'Downloaded_Report_Phone.png']]){await inspect.setViewportSize({width,height});descriptors.push(await snapshot(inspect,root,name));}
  if(!await exists(path.join(root,'Downloaded_Report_Text.txt')))await keep(root,'Downloaded_Report_Text.txt',Buffer.from(await inspect.locator('body').innerText()));
  for(const name of ['Original_Intervals.csv','All_Source_Rows.csv','Complete_Record.json','All_168_Hours.csv']){
   const bytes=await fs.readFile(path.join(root,name));await inspect.setContent('<!doctype html><title>GridKind original attachment</title><h1></h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>');
   await inspect.locator('h1').evaluate((el,t)=>{el.textContent=t;},name);await inspect.locator('pre').evaluate((el,t)=>{el.textContent=t;},bytes.toString('utf8'));
   need(await inspect.locator('pre').textContent()===bytes.toString('utf8'),'The exact downloaded attachment was not opened.');if(!await exists(path.join(root,name+'.view.txt')))await keep(root,name+'.view.txt',Buffer.from(await inspect.locator('body').innerText()));
  }
 }finally{await inspect.close();}
 descriptors.push(await working(page,root,'Complete_Browser_Working.json'));const artifacts=await allFiles(root);await keep(root,'result.json',json({binding,artifacts}));return artifacts;
}
async function allFiles(root,relative=''){
 const out=[];for(const entry of(await fs.readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name.startsWith('.')||(!relative&&(entry.name==='result.json'||entry.name==='Complete_Measured_Energy_Case.json')))continue;
  const name=path.join(relative,entry.name);need(!entry.isSymbolicLink(),'Complete operated case cannot contain symlinks.');
  if(entry.isDirectory())out.push(...await allFiles(root,name));else{const raw=await fs.readFile(path.join(root,name));out.push({file:name,path:path.join(root,name),bytes:raw.length,sha256:sha(raw)});}
 }return out;
}
async function selectedIdentity(page){
 const u=new URL(page.url());need(['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname),'Select the original loopback page.');
 const state=await api(page,'/api/state'),cookies=await page.context().cookies(u.origin),sid=cookies.find(x=>x.name==='gridkind_sid')?.value;
 need(sid,'The page must already belong to its original visitor.');return{origin:u.origin,identity:sha(Buffer.from(sid)),state};
}
async function coldReceive(page,root,bundle,selected){
 const directory=path.join(root,'receiving');await fs.mkdir(directory,{recursive:true});
 const inputName='Original_Household_Input.json';await keep(directory,inputName,json(bundle));
 let state=await api(page,'/api/state'),matches=[];
 for(const h of state.workspace.households){
  const old=await api(page,'/api/workspace/export?householdId='+h.id);
  if(old.payload.household.origin?.householdId===bundle.payload.household.id&&old.payload.household.origin?.sha256===bundle.sha256)matches.push(h.id);
 }
 need(matches.length<=1,'More than one original cold receive already exists; select its actual receipt explicitly.');
 if(matches.length){
  if(state.workspace.selectedId!==matches[0])state=(await api(page,'/api/workspace',{action:'select',householdId:matches[0],context:context(state)})).state;
 }else{
  // Preserve exact original request context before non-idempotent import. If a response is
  // lost, scan the immutable origin above; otherwise its old revision prevents a duplicate.
  const reqFile=path.join(directory,'Import_Request.json');let body;
  if(await exists(reqFile))body=await readJSON(reqFile);
  else{body={action:'import',name:'Measured energy receiving',bundle,context:context(state)};await keep(directory,'Import_Request.json',json(body));}
  need(same(body.bundle,bundle),'Retained import selected another complete household.');
  const result=await api(page,'/api/workspace',body);await keep(directory,'Import_Result.json',json(result));state=result.state;
 }
 const received=await api(page,'/api/workspace/export');
 need(received.payload.household.origin?.householdId===bundle.payload.household.id&&received.payload.household.origin.sha256===bundle.sha256,'Cold receiving origin differs.');
 need(same(received.payload.records,bundle.payload.records),'Cold receive lost original saved records.');
 const wrapped=(bundle.payload.assistantRequests??[]).map(row=>{const {sha256,...source}=row;const body={...source,receivedFrom:{householdId:bundle.payload.household.id,sha256,sourceReceipt:row}};return {...body,sha256:energyDigest(body)};});
 need(same(received.payload.assistantRequests??[],wrapped),'Cold receive lost exact original assistant receipt lineage.');
 await api(page,'/api/workspace',{action:'preview-import',bundle:received,context:context(state)});
 need(!state.approved&&!state.receipt,'Receiving must not activate original device execution.');
 const source=await api(page,'/api/workspace/record?id='+selected.source.id),week=await api(page,'/api/workspace/record?id='+selected.week.id),review=await api(page,'/api/workspace/record?id='+selected.review.id);
 need(same(source,selected.source)&&same(week,selected.week)&&same(review,selected.review),'Cold received energy source/plan/review identities differ.');inspectEnergyReview(review.detail.review,source,week);
 await keep(directory,'Received_Record_Identities.json',json({household:state.workspace.selectedId,source:source.sha256,week:week.sha256,review:review.sha256,origin:received.payload.household.origin}));
 await open(page,new URL(page.url()).origin);await page.locator('#reload').click();await idle(page);await exported(page,directory,review,source,week);
 return{household_id:state.workspace.selectedId,source_id:source.id,week_id:week.id,review_id:review.id};
}
export async function receiveEnergyReview({page,receivingPage,source,weekId,title,note='',output,operationId,applicationPacket,sourceCompanions=[],authoredWeek=null}){
 need(page&&receivingPage&&page!==receivingPage,'Borrow distinct original author and cold-receiving pages.');
 need(typeof operationId==='string'&&operationId.trim(),'Retain the original operation ID.');
 const root=path.resolve(output);need(!inside(APP,root)&&!inside(root,APP),'Output and application source must be disjoint.');
 const raw=await fs.readFile(source),input=energySourceInput(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw)));
 need(input.filename===path.basename(input.filename),'Use the original plain CSV filename.');
 const packetRaw=await fs.readFile(applicationPacket),packet=JSON.parse(packetRaw);need(Array.isArray(packet.files)&&packet.files.length>=47,'Supply the complete current application source packet.');
 for(const f of packet.files){
  need(typeof f.path==='string'&&typeof f.content==='string'&&(f.path==='AGENTS.md'||f.path.startsWith('amazon-gridkind-alexa-2026/')),'Unexpected source member.');
  const target=path.resolve(path.dirname(APP),f.path);need(inside(path.dirname(APP),target),'Source member escapes application checkout.');
  const bytes=await fs.readFile(target);need(bytes.equals(Buffer.from(f.content))&&(!f.sha256||sha(bytes)===f.sha256),'Installed original source differs: '+f.path);
 }
 const evidence=[],names=new Set();for(const filename of sourceCompanions){const name=path.basename(filename);need(!names.has(name),'Source evidence filenames must be unique.');names.add(name);const bytes=await fs.readFile(filename);evidence.push({file:name,path:filename,bytes:bytes.length,sha256:sha(bytes)});}
 const author=await selectedIdentity(page),receiver=await selectedIdentity(receivingPage);need(author.identity!==receiver.identity||author.origin!==receiver.origin,'Author and receiver must be independent original workspaces.');
 const home=author.state.workspace.selectedId;
 const authoredBytes=authoredWeek?await fs.readFile(authoredWeek):null;
 const selection={schema:'gridkind-energy-original-selection/v1',operation_id:operationId,source_input_sha256:sha(raw),source_companions:evidence.map(({path,...x})=>x),application_sha256:sha(packetRaw),author_identity:author.identity,receiver_identity:receiver.identity,household_id:home,week_id:weekId??null,authored_week_sha256:authoredBytes?sha(authoredBytes):null,title,note};
 await keep(root,'Selection.json',json(selection));await keep(root,'Original_Source_Input.json',raw);if(authoredBytes)await keep(root,'Original_Authored_Week.json',authoredBytes);
 let week;
 need(Boolean(weekId)!==Boolean(authoredWeek),'Choose an original saved week ID or one explicit authored week file.');
 if(authoredWeek){const authored=await readJSON(authoredWeek);week=await ensureAuthoredWeek({read:route=>api(page,route),post:(route,body)=>api(page,route,body),input:authored,output:path.join(root,'authored-week')});weekId=week.id;}
 else week=await api(page,'/api/workspace/record?householdId='+home+'&id='+weekId);
 need(week.kind==='week','Select the actual saved weekly plan.');
 const binding={schema:'gridkind-energy-operating-binding/v1',operation_id:operationId,source_input_sha256:sha(raw),source_companions:evidence.map(({path,...x})=>x),application_sha256:sha(packetRaw),author_identity:author.identity,receiver_identity:receiver.identity,household_id:home,week_id:weekId,week_sha256:week.sha256,title,note};
 await keep(root,'Input.json',json(binding));for(const f of evidence)await keep(root,'source-evidence/'+f.file,await verifyFile(f));await keep(root,'Original_Source_Input.json',raw);await keep(root,'Complete_Application_Source.json',packetRaw);await keep(root,'Original_Week_Record.json',json(week));
 if(await exists(path.join(root,'result.json'))){const result=await readJSON(path.join(root,'result.json'));need(same(result.binding,binding),'Completed operation selects another source.');for(const x of result.artifacts)await verifyFile(x);await verifyFile(result.complete_case);return result;}
 const views=[page.viewportSize(),receivingPage.viewportSize()];
 try{
  await open(page,author.origin);
  const preview=previewEnergySource(input),sourceIntent={action:'save-source',source:input,previewSha256:preview.sha256};
  let sourceRecord;
  if(await exists(path.join(root,'Source_Record.json'))){sourceRecord=await readJSON(path.join(root,'Source_Record.json'));const actual=await api(page,'/api/workspace/record?householdId='+home+'&id='+sourceRecord.id);need(same(actual,sourceRecord)&&same(actual.detail.edition,preview),'Original saved source changed.');if(await exists(path.join(root,'Source_Request.json')))await resume(page,author.origin,root,'Source',home,sourceIntent);}
  else if(await exists(path.join(root,'Source_Request.json')))sourceRecord=await resume(page,author.origin,root,'Source',home,sourceIntent);
  else{
   need(await page.locator('#pending').isHidden(),'Preserve and finish the existing unrelated pending work before this selected course.');
   await working(page,root,'Existing_Author_Working.json');
   await page.locator('#csv-file').setInputFiles({name:input.filename,mimeType:'text/csv',buffer:Buffer.from(input.csv)});await idle(page);
   const fields={title:input.title,timezone:input.timezone,'source-url':input.sourceUrl,note:input.note,'meter-description':input.meter.description,'load-ids':input.meter.loadIds.join('\n')};
   for(const[k,v]of Object.entries(fields))await page.locator('#'+k).fill(v);
   for(const[k,v]of Object.entries({role:input.role,unit:input.unit,'meter-kind':input.meter.kind,'map-start':input.mapping.start,'map-end':input.mapping.end,'map-energy':input.mapping.energy}))await page.locator('#'+k).selectOption(v);
   const observed=await response(page,'#preview-source','preview-source');need(same(observed.preview,preview),'UI source preview differs from exact original source.');
   sourceRecord=await saveThroughUI(page,author.origin,root,'Source',home,sourceIntent,'#save-source');
  }
  const expected=reviewEnergy(sourceRecord,week,{title,note}),reviewIntent={action:'save-review',sourceId:sourceRecord.id,weekId,title:title.trim(),note,previewSha256:expected.sha256};
  let review;
  if(await exists(path.join(root,'Review_Record.json'))){review=await readJSON(path.join(root,'Review_Record.json'));need(same(await api(page,'/api/workspace/record?householdId='+home+'&id='+review.id),review),'Retained review changed.');if(await exists(path.join(root,'Review_Request.json')))await resume(page,author.origin,root,'Review',home,reviewIntent);}
  else if(await exists(path.join(root,'Review_Request.json')))review=await resume(page,author.origin,root,'Review',home,reviewIntent);
  else{
   await open(page,author.origin);await selectSaved(page,'source',sourceRecord.id);await selectSaved(page,'week',week.id);await page.locator('#review-title').fill(title);await page.locator('#review-note').fill(note);
   const v=await response(page,'#preview-review','preview-review');need(same(v.preview,expected),'UI review differs from actual source and selected saved week.');
   review=await saveThroughUI(page,author.origin,root,'Review',home,reviewIntent,'#save-review',{loseResponse:true});
  }
  inspectEnergyReview(review.detail.review,sourceRecord,week);
  const authorDir=path.join(root,'author');await fs.mkdir(authorDir,{recursive:true});await open(page,author.origin);await exported(page,authorDir,review,sourceRecord,week);
  let bundle;const backup=path.join(root,'Complete_Household.json');
  if(await exists(backup)){bundle=await readJSON(backup);const current=await api(page,'/api/workspace/export?householdId='+home);need(same(current.payload,bundle.payload)&&current.sha256===bundle.sha256,'Author household advanced after its frozen complete export.');}
  else{
   await selectSaved(page,'review',review.id);await page.locator('#load-review').click();await idle(page);
   const d=await download(page,root,'Complete_Household.json',()=>page.getByRole('link',{name:'Complete household with all sources',exact:true}).click());bundle=JSON.parse(await verifyFile(d));
   need(bundle.payload.household.id===home&&bundle.payload.records.some(r=>r.id===review.id),'Downloaded household omitted the actual selected review.');
  }
  const cold=await coldReceive(receivingPage,root,bundle,{source:sourceRecord,week,review});
  const artifacts=await allFiles(root),members=[];
  for(const f of artifacts)members.push({file:f.file,bytes:f.bytes,sha256:f.sha256,content_base64:(await verifyFile(f)).toString('base64')});
  const full={schema:'gridkind-measured-energy-complete-case/v1',binding,source_record_id:sourceRecord.id,review_record_id:review.id,receiving:cold,files:members};
  const complete=await keep(root,'Complete_Measured_Energy_Case.json',json(full));
  const result={schema:'gridkind-energy-operating-result/v1',binding,source_record_id:sourceRecord.id,review_record_id:review.id,receiving:cold,artifacts,complete_case:complete,status:'complete',inspection:'Actual browser pages and literal downloaded files opened at desktop and narrow widths. Screenshots and text retained for the original operator’s visual review.'};
  await keep(root,'result.json',json(result));return result;
 }finally{for(const[p,v]of [[page,views[0]],[receivingPage,views[1]]])if(v&&!p.isClosed())await p.setViewportSize(v);}
}
