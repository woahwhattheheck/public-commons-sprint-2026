/**
 * Complete large-collection chapter for the original owned Measurements receiver.
 * Operates the actual retained eight-station CSV and four original companions.
 * The caller supplies the existing lifecycle and actual original portable workspace.
 */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {MeasurementWorkspace} from './workspace.mjs';
import {largeCollectionStatus} from './large_collections.mjs';
import {editionInfo,receiveArchive} from './large_delivery.mjs';

const schema='upstate.large-collection-receiving/v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const comparable=value=>({...value,createdAt:''});
const order=rows=>rows.map(row=>JSON.stringify(row)).sort();
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ORIGINALS=[
 {name:'wqp_eight_native.csv',bytes:3640,sha256:'21022c3f3b46fb0bae6e341cde74880ec2e395528592f9168742f53af60b533e',kind:'stations'},
 {name:'wqp_eight_source_metadata.json',bytes:4364,sha256:'cd9bece111d31aa68748507ae68ddfa0ac0a739f9d215f52149cde5d302d0605',kind:'companion'},
 {name:'wqp_eight_monitoring_sites.geojson',bytes:17794,sha256:'d7322856d96cdd6898a5cef555e97529f99ec4d6dad7ab45d18f4d53f3b646e6',kind:'companion'},
 {name:'wqp_eight_station_page_extractions.json',bytes:50756,sha256:'691f1020850d35deb2c06c4e765590e1df747824bf5ea70d955263ff4595d91f',kind:'companion'},
 {name:'sources.json',bytes:1533,sha256:'e2a566cad4d08ff4f2c61aae6ca44a097bf0eecb8a86f94b5cde2fa18c96b76a',kind:'companion'}
];
async function exists(file){try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function digestFile(file){
 const stat=await fs.lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'Retain a regular original file: '+file);
 const digest=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){digest.update(chunk);bytes+=chunk.length;}return {bytes,sha256:digest.digest('hex')};
}
async function snapshot(directory){const w=new MeasurementWorkspace(directory);try{return w.portable();}finally{w.close();}}
function preserved(original,current){
 for(const key of ['records','import_records','mappings','reviews','selected_versions'])assert.deepEqual(order(original.tables[key]),order(current.tables[key]),'Station collection changed original '+key);
 for(const key of ['imports','events','exports'])for(const row of original.tables[key])assert(current.tables[key].some(value=>JSON.stringify(value)===JSON.stringify(row)),'Station collection lost an original '+key+' row');
 if(original.intake)assert.deepEqual(original.intake,current.intake,'Original guided-intake history changed');
}
async function api(page,endpoint,suffix,method='GET',data){
 const response=await page.request.fetch(endpoint+'/api/measurement-workspace'+suffix,{method,...(data===undefined?{}:{data})});
 assert(response.ok(),'Original collection '+method+' '+suffix+' failed ('+response.status()+'): '+await response.text());return response.json();
}
async function open(page,endpoint){
 const handler=dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss();page.on('dialog',handler);try{await page.goto(endpoint);}finally{page.off('dialog',handler);}const box=page.locator('.measured-collections');await box.locator('[data-action=refresh]').waitFor();
 await box.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;}));return box;
}
async function idle(box){await box.locator('[data-action=refresh]:not([disabled])').waitFor();}
async function screen(page,box,root,name,width){
 if(await exists(path.join(root,name)))return;
 await page.setViewportSize({width,height:width===390?844:1000});await box.scrollIntoViewIfNeeded();
 await box.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;}));
 await page.screenshot({path:path.join(root,name),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Collection document overflows '+width+' pixels');
}
async function progress(root,helpers,patch){
 const file=path.join(root,'progress.json'),before=await exists(file)?JSON.parse(await fs.readFile(file,'utf8')):{};
 if(patch){const value={...before,...patch};await helpers.atomic(file,value);return value;}return before;
}
async function capture(page,root,name,click){
 const [download]=await Promise.all([page.waitForEvent('download'),click()]);assert.equal(await download.failure(),null,'Complete browser download failed');
 const temporary=path.join(root,name+'.download');await fs.mkdir(path.dirname(temporary),{recursive:true});await download.saveAs(temporary);
 const identity=await digestFile(temporary),target=path.join(root,name);
 try{await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await digestFile(target),identity,'An earlier complete output differs: '+name);}finally{await fs.rm(temporary,{force:true});}
 return {path:name,...identity};
}
async function working(page,box,prepared,helpers,label){
 const temp=path.join(prepared.root,'working-download-'+Date.now()+'.json');
 const [download]=await Promise.all([page.waitForEvent('download'),box.locator('[data-action=save]').click()]);
 assert.equal(await download.failure(),null);await download.saveAs(temp);
 const raw=await helpers.regular(temp),body=JSON.parse(raw.toString('utf8')),name='working-'+hash(raw)+'.json';
 await helpers.exact(path.join(prepared.root,name),raw);await fs.rm(temp);
 await progress(prepared.root,helpers,{working_file:name,working_label:label});return body;
}
/** Keep the product's automatic complete before-open backups as real outputs. */
function retainBrowserBackups(page,prepared){
 const tasks=[],errors=[];let sequence=0;
 const handler=download=>{
  if(!/^collection-before-(?:open|new)\.json$/.test(download.suggestedFilename()))return;
  const task=(async()=>{
   const directory=path.join(prepared.root,'browser-backups');await fs.mkdir(directory,{recursive:true});
   const temporary=path.join(directory,'backup-'+Date.now()+'-'+(++sequence)+'.download');
   try{
    assert.equal(await download.failure(),null,'The automatic complete working backup failed');await download.saveAs(temporary);
    const identity=await digestFile(temporary),target=path.join(directory,'working-'+identity.sha256+'.json');
    try{await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await digestFile(target),identity,'The saved automatic working backup changed');}
   }finally{await fs.rm(temporary,{force:true});}
  })().catch(error=>{errors.push(error);});tasks.push(task);
 };
 page.on('download',handler);
 return async()=>{page.off('download',handler);await Promise.all(tasks);if(errors.length)throw new AggregateError(errors,'Retain all automatic complete working backups before closing this browser.');};
}
async function restore(page,box,prepared,file){
 const name=file||(await progress(prepared.root,prepared.helpers)).working_file;if(!name)return;
 await box.locator('[data-open]').setInputFiles(path.join(prepared.root,name));await idle(box);
 await box.locator('[data-status]').filter({hasText:'Opened the complete working file'}).waitFor();
}
/** Retain the actual full browser envelope while its original request is admitted. */
async function admittedWorking(page,prepared,helpers,label,request){
 const value=await page.evaluate(({request})=>{
  const matches=[];
  for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith('measurement-collection-working/v1:'))continue;let envelope;try{envelope=JSON.parse(localStorage.getItem(key));}catch{continue;}
   const state=envelope?.state;if(state?.pending&&JSON.stringify(state.pending.payload)===JSON.stringify(request))matches.push(state);
  }
  if(matches.length!==1)throw Error('The original admitted request must select one complete saved browser working file.');return matches[0];
 },{request});
 assert.deepEqual(value.pending.payload,request);const name=label+'-admitted-working.json';await helpers.exact(path.join(prepared.root,name),value);return name;
}
/** An admitted working file is the first durable half of one request checkpoint.
 * A stopped writer can recreate only its identical second half from that file.
 */
async function retainedAdmission(prepared,helpers,label){
 const workingFile=label+'-admitted-working.json',requestFile=label+'-request.json';
 const workingPath=path.join(prepared.root,workingFile),requestPath=path.join(prepared.root,requestFile);
 const hasWorking=await exists(workingPath),hasRequest=await exists(requestPath);
 if(!hasWorking&&!hasRequest)return null;
 assert(hasWorking,'The retained request is missing its complete admitted working file: '+label);
 const state=JSON.parse((await helpers.regular(workingPath)).toString('utf8'));
 assert(state.pending&&state.pending.payload&&typeof state.pending.payload==='object','The admitted working file must retain the exact pending body: '+label);
 const request=state.pending.payload;
 if(hasRequest)assert.deepEqual(JSON.parse((await helpers.regular(requestPath)).toString('utf8')),request,'The two original request checkpoint files disagree: '+label);
 else await helpers.exact(requestPath,request);
 return {request,workingFile};
}
async function retainAdmission(page,prepared,helpers,label,request,{trackWorking=true}={}){
 await admittedWorking(page,prepared,helpers,label,request);
 const retained=await retainedAdmission(prepared,helpers,label);assert.deepEqual(retained.request,request);
 if(trackWorking)await progress(prepared.root,helpers,{working_file:retained.workingFile,working_label:label});
 return retained;
}
async function dispatchWithLostReply(page,box,endpoint,prepared,helpers,{label,suffix,method,click,checkRequest}){
 const requestPath=path.join(prepared.root,label+'-request.json'),acceptedPath=path.join(prepared.root,label+'-accepted.json');
 const retained=await retainedAdmission(prepared,helpers,label);
 if(retained){
  checkRequest(retained.request);await restore(page,box,prepared,retained.workingFile);
  await box.locator('[data-action=resume]').click();await idle(box);
  assert.equal(await box.locator('[data-pending]').isVisible(),false,'Exact saved request did not recover');
  await working(page,box,prepared,helpers,label+'-recovered');
  return retained.request;
 }
 let seen=false,problem=null;
 const pattern=endpoint+'/api/measurement-workspace'+suffix;
 const handler=async route=>{
  if(route.request().method()!==method||seen)return route.continue();
  seen=true;
  try{
   const body=route.request().postDataJSON();checkRequest(body);await retainAdmission(page,prepared,helpers,label,body);
   const response=await route.fetch(),responseBody=await response.text();
   await helpers.exact(path.join(prepared.root,label+'-native-response.json'),{status:response.status(),body:responseBody});
   if(!response.ok()){await route.fulfill({response});return;}
   await helpers.exact(acceptedPath,JSON.parse(responseBody));await route.abort('failed');
  }catch(error){problem=error;await route.abort('failed').catch(()=>{});}
 };
 await page.route(pattern,handler);
 try{
  await click();await idle(box);if(problem)throw problem;
  assert(seen,'The expected complete original UI request was not admitted');assert(await exists(acceptedPath),'The retained native response was not successful; continue this original request after inspecting its source result.');
  assert(await box.locator('[data-pending]').isVisible(),'The lost reply must retain its complete original request');
  await working(page,box,prepared,helpers,label+'-interrupted');
 }finally{await page.unroute(pattern,handler);}
 // Reopen the actual product working file in a fresh page load before retry.
 const reopened=await open(page,endpoint);await restore(page,reopened,prepared,label+'-admitted-working.json');
 await reopened.locator('[data-action=resume]').click();await idle(reopened);
 assert.equal(await reopened.locator('[data-pending]').isVisible(),false,'The complete original request did not recover');
 await working(page,reopened,prepared,helpers,label+'-recovered');
 return JSON.parse(await fs.readFile(requestPath,'utf8'));
}
/** The same receiver lifecycle with a collection-specific original-copy setup.
 * Source Versions requires measurement records for comparison; collections also
 * accept a real station-only portable workspace, without manufacturing records.
 */
export async function prepareLargeCollectionReceiving(options,helpers){
 assert(options.portableFile&&options.output&&options.reviewer?.trim()&&options.reason?.trim(),'Supply the actual original portable workspace, owned output, reviewer and reason.');
 const source=await fs.realpath(path.resolve(options.portableFile)),rawPortable=await helpers.regular(source),portable=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rawPortable));
 assert.equal(portable.format,'upper-savannah-measurements');assert.equal(portable.version,1);assert(portable.tables?.imports?.length,'Select the complete actual native workspace with its retained original source bodies.');
 const requested=path.resolve(options.output);await fs.mkdir(requested,{recursive:true});const parent=await fs.realpath(requested),root=path.join(parent,'large-collections'),directory=path.join(root,'owned-workspace');
 assert(source!==root&&!source.startsWith(root+path.sep),'Keep the original portable file outside the owned receiving copy.');
 if(await exists(root)){const info=await fs.lstat(root);assert(info.isDirectory()&&!info.isSymbolicLink(),'The receiving copy must be its own original directory.');assert(await exists(path.join(root,'selection.json'))||(await fs.readdir(root)).length===0,'Retain an existing non-owned directory unchanged.');}
 else await fs.mkdir(root);
 await helpers.assertOwnedTree(root);
 const sourceRoot=fileURLToPath(new URL('../../source_data/wqp_eight_20261013/',import.meta.url)),files=[];
 for(const expected of ORIGINALS){
  const raw=await helpers.regular(path.join(sourceRoot,expected.name));assert.equal(raw.length,expected.bytes);assert.equal(hash(raw),expected.sha256,'Original eight-station source changed: '+expected.name);
  files.push({...expected,path:path.join(root,'originals',expected.name),raw});
 }
 const reaches=options.reachesFile?await helpers.regular(await fs.realpath(options.reachesFile)):null;if(reaches)assert(Array.isArray(JSON.parse(reaches.toString('utf8'))),'Select the original complete reaches.json array.');
 const selection={schema,original_portable_path:source,original_portable_sha256:hash(rawPortable),original_portable_bytes:rawPortable.length,receiving_baseline_sha256:hash(json(comparable(portable))),reviewer:options.reviewer.trim(),reason:options.reason.trim(),
  title:'Original SCDES/WQP eight-station locations and full source metadata',mapping:{station:'MonitoringLocationName'},files:files.map(({path,raw,...value})=>value),reaches_sha256:reaches?hash(reaches):null,
  interpretation:'Eight actual station metadata records and four unchanged original source companions. Existing observation records remain unchanged; all reports use their original scientific eligibility.'};
 await helpers.exact(path.join(root,'selection.json'),selection);
 await helpers.exact(path.join(root,'original-workspace.json'),rawPortable);
 for(const file of files){await helpers.exact(file.path,file.raw);delete file.raw;}
 await fs.mkdir(directory,{recursive:true});await helpers.assertOwnedTree(directory);
 if(reaches){await helpers.exact(path.join(root,'original-reaches.json'),reaches);await helpers.exact(path.join(directory,'reaches.json'),reaches);}
 const workspace=new MeasurementWorkspace(directory);
 try{if(!workspace.summary().imports.length)workspace.receive(portable);preserved(portable,workspace.portable());}finally{workspace.close();}
 return {root,directory,before:portable,selection,files,helpers};
}
async function freshOriginalSelection(box,prepared){
 await box.locator('[data-title]').fill(prepared.selection.title);
 await box.locator('[data-add]').setInputFiles(prepared.files.map(f=>f.path));
 const row=box.locator('tr[data-key]').filter({hasText:'wqp_eight_native.csv'});await row.locator('[data-field=kind]').selectOption('stations');await row.locator('[data-field=mappingText]').fill(JSON.stringify(prepared.selection.mapping));
}
async function reselectOriginals(box,prepared){
 for(const f of prepared.files){const row=box.locator('tr[data-key]').filter({hasText:f.name});assert.equal(await row.count(),1,'The complete working copy lost original '+f.name);await row.locator('[data-reselect]').setInputFiles(f.path);}
}
async function listCollection(box,id){
 await box.locator('[data-action=refresh]').click();await idle(box);await box.locator('[data-collection="'+id+'"]').click();await idle(box);
}
async function downloadEdition(page,box,prepared,edition,helpers,prefix){
 const downloaded=[];
 for(const member of edition.files){
  const filename=prefix+'/'+member.path;assert(!member.path.includes('..')&&!path.isAbsolute(member.path),'Unexpected native member path');
  const target=path.join(prepared.root,filename);let identity;
  if(await exists(target))identity={path:filename,...await digestFile(target)};
  else identity=await capture(page,prepared.root,filename,()=>box.locator('[data-download-edition="'+edition.id+'"][data-member="'+member.path+'"]').click());
  assert.equal(identity.bytes,member.bytes);assert.equal(identity.sha256,member.sha256,'Complete native member download changed: '+member.path);downloaded.push({...identity,native_path:member.path});
 }
 await helpers.exact(path.join(prepared.root,prefix+'-downloads.json'),{editionId:edition.id,files:downloaded});return downloaded;
}
/** Call with the receiver's existing owned page and server; no lifecycle is created. */
export async function operateLargeCollectionReceiving({page,endpoint,prepared,helpers}){
 assert.deepEqual(comparable(await api(page,endpoint,'/portable')),comparable(await snapshot(prepared.directory)),'This page does not serve the selected owned collection-receiving workspace.');
 preserved(prepared.before,await api(page,endpoint,'/portable'));
 const errors=[],onError=error=>errors.push(String(error));page.on('pageerror',onError);const drainBackups=retainBrowserBackups(page,prepared);let box,phase;
 try{
  box=await open(page,endpoint);phase=await progress(prepared.root,helpers);
  if(phase.working_file)await restore(page,box,prepared,phase.working_file);
  if(!phase.source_recovered){
   const sourceAdmission=await retainedAdmission(prepared,helpers,'source');
   if(!sourceAdmission){
    await freshOriginalSelection(box,prepared);await working(page,box,prepared,helpers,'unfinished-source-selection');
   }else await restore(page,box,prepared,sourceAdmission.workingFile);
   await dispatchWithLostReply(page,box,endpoint,prepared,helpers,{label:'source',suffix:'/large/intakes/*/chunks',method:'PUT',click:()=>box.locator('[data-action=inspect]').click(),checkRequest:body=>{assert.equal(body.offset,0);assert.equal(body.sha256,ORIGINALS[0].sha256);assert.equal(Buffer.from(body.base64,'base64').length,ORIGINALS[0].bytes);}});
   phase=await progress(prepared.root,helpers,{source_recovered:true});box=page.locator('.measured-collections');
  }
  if(!phase.inspected){
   if(phase.working_file)await restore(page,box,prepared,phase.working_file);
   await reselectOriginals(box,prepared);await box.locator('[data-action=inspect]').click();await idle(box);
   await box.locator('[data-status]').filter({hasText:'Complete source inspection is ready'}).waitFor();
   const workingFile=await working(page,box,prepared,helpers,'complete-inspection');assert.equal(workingFile.inspected.response.files.length,5);
   const actual=workingFile.inspected.response.inspection.find(f=>f.kind==='stations');assert.equal(actual.preview.summary.rows,8);assert.equal(actual.preview.sourceSha256,ORIGINALS[0].sha256);
   await helpers.exact(path.join(prepared.root,'actual-complete-inspection.json'),workingFile.inspected);
   phase=await progress(prepared.root,helpers,{inspected:true,collection_id:workingFile.inspected.response.id});
   await screen(page,box,prepared.root,'collection-inspection-desktop.png',1440);await screen(page,box,prepared.root,'collection-inspection-390.png',390);
  }
  if(!phase.receive_recovered){
   if(phase.working_file)await restore(page,box,prepared,phase.working_file);
   await dispatchWithLostReply(page,box,endpoint,prepared,helpers,{label:'receive',suffix:'/large/collections/receive',method:'POST',click:()=>box.locator('[data-action=receive]').click(),checkRequest:body=>{assert.equal(body.expectedId,phase.collection_id);assert(body.operationId&&body.expectedReviewSha256&&Number.isSafeInteger(body.expectedRevision));assert.equal(body.files.length,5);}});
   phase=await progress(prepared.root,helpers,{receive_recovered:true});box=page.locator('.measured-collections');
  }
  const status=await api(page,endpoint,'/large/collections/'+phase.collection_id);assert(status.complete);assert.equal(status.files.length,5);if(!await exists(path.join(prepared.root,'received-collection.json')))await helpers.exact(path.join(prepared.root,'received-collection.json'),status);else{const old=JSON.parse(await fs.readFile(path.join(prepared.root,'received-collection.json'),'utf8'));assert.equal(old.id,status.id);assert.deepEqual(old.files,status.files);}
  preserved(prepared.before,await api(page,endpoint,'/portable'));
  await listCollection(box,phase.collection_id);
  if(!phase.publication_recovered){
   const request=await dispatchWithLostReply(page,box,endpoint,prepared,helpers,{label:'publication',suffix:'/large/collections/'+phase.collection_id+'/publish',method:'POST',click:()=>box.locator('[data-publish="'+phase.collection_id+'"]').click(),checkRequest:body=>{assert(/^[a-f0-9]{64}$/.test(body.id));assert(Number.isSafeInteger(body.expectedRevision));assert.deepEqual(body.filters,{});}});
   phase=await progress(prepared.root,helpers,{publication_recovered:true,edition_id:request.id});box=page.locator('.measured-collections');
  }
  await listCollection(box,phase.collection_id);await box.locator('[data-large-edition="'+phase.edition_id+'"]').click();await idle(box);
  const edition=await api(page,endpoint,'/large/editions/'+phase.edition_id);assert.equal(edition.collectionBinding.collectionId,phase.collection_id);await helpers.exact(path.join(prepared.root,'complete-edition.json'),edition);
  const downloads=await downloadEdition(page,box,prepared,edition,helpers,'sender-edition');assert(downloads.some(f=>f.native_path==='project.zip'));
  await screen(page,box,prepared.root,'collection-edition-desktop.png',1440);await screen(page,box,prepared.root,'collection-edition-390.png',390);
  await working(page,box,prepared,helpers,'complete-received-and-published');
  const current=await api(page,endpoint,'/portable'),portableFile=path.join(prepared.root,'sender-portable.json'),returned=await exists(portableFile)?JSON.parse(await fs.readFile(portableFile,'utf8')):current;preserved(prepared.before,current);assert.deepEqual(comparable(returned),comparable(current),'The completed sender workspace has advanced; retain the current original edition and receiving course.');await helpers.exact(portableFile,returned);
  assert.deepEqual(errors,[],'Collection browser raised an exception');await drainBackups();phase=await progress(prepared.root,helpers,{browser_complete:true});
  return {collectionId:phase.collection_id,edition,downloads,portable:returned,progress:phase};
 }catch(error){
  try{if(box&&await box.locator('[data-action=save]').count())await working(page,box,prepared,helpers,'interrupted');}catch(saveError){error.workingSaveError=String(saveError);}
  throw error;
 }finally{page.off('pageerror',onError);await drainBackups();}
}
async function retainedSenderResult(prepared,helpers){
 const phase=await progress(prepared.root,helpers);assert(phase.browser_complete,'The sender course is not complete');
 const read=async name=>JSON.parse((await helpers.regular(path.join(prepared.root,name))).toString('utf8'));
 const portable=await read('sender-portable.json'),edition=await read('complete-edition.json'),receipt=await read('sender-edition-downloads.json'),collection=await read('received-collection.json');
 assert.equal(edition.id,phase.edition_id);assert.equal(edition.collectionBinding.collectionId,phase.collection_id);assert.equal(collection.id,phase.collection_id);assert(collection.complete);
 assert.equal(receipt.editionId,edition.id);assert.equal(receipt.files.length,edition.files.length);
 const paths=new Set();
 for(const member of edition.files){
  assert(!paths.has(member.path),'The completed native edition repeats a member');paths.add(member.path);
  const received=receipt.files.filter(file=>file.native_path===member.path);assert.equal(received.length,1);
  const file=received[0];assert.equal(file.path,'sender-edition/'+member.path);assert.equal(file.bytes,member.bytes);assert.equal(file.sha256,member.sha256);
  assert.deepEqual(await digestFile(path.join(prepared.root,file.path)),{bytes:member.bytes,sha256:member.sha256});
 }
 assert(paths.has('project.zip'),'Retain the original complete sender project archive');
 assert(/^working-[a-f0-9]{64}\.json$/.test(phase.working_file),'The completed sender must retain its complete working file');
 const workingPath=path.join(prepared.root,phase.working_file),workingRaw=await helpers.regular(workingPath);
 assert.equal('working-'+hash(workingRaw)+'.json',phase.working_file);assert.equal(JSON.parse(workingRaw.toString('utf8')).pending,null,'The completed sender working file retains a pending request');
 preserved(prepared.before,portable);
 const workspace=new MeasurementWorkspace(prepared.directory);
 try{
  preserved(portable,workspace.portable());const current=largeCollectionStatus(workspace,phase.collection_id);
  assert(current.complete);assert.equal(current.id,collection.id);assert.deepEqual(current.files,collection.files);
  assert.deepEqual(editionInfo(workspace,edition.id),edition);
  for(const source of prepared.files)assert.deepEqual(await digestFile(path.join(prepared.directory,'collections',phase.collection_id,'sources',source.name)),{bytes:source.bytes,sha256:source.sha256});
 }finally{workspace.close();}
 return {collectionId:phase.collection_id,edition,downloads:receipt.files,portable,progress:phase};
}
async function coldReceive(prepared,result,helpers){
 const directory=path.join(prepared.root,'cold-received'),archive=path.join(prepared.root,'sender-edition','project.zip');await fs.mkdir(directory,{recursive:true});await helpers.assertOwnedTree(directory);
 const identity=await digestFile(archive),expected=result.edition.files.find(f=>f.path==='project.zip');assert.deepEqual(identity,{bytes:expected.bytes,sha256:expected.sha256});
 const receipt=path.join(prepared.root,'cold-receive.json'),w=new MeasurementWorkspace(directory);
 try{
  if(!await exists(receipt)){const value=receiveArchive(w,archive);await helpers.exact(receipt,value);}
  preserved(result.portable,w.portable());const selected=largeCollectionStatus(w,result.collectionId);assert(selected.complete);assert.equal(selected.id,result.collectionId);
  for(const source of prepared.files){const current=await digestFile(path.join(directory,'collections',result.collectionId,'sources',source.name));assert.deepEqual(current,{bytes:source.bytes,sha256:source.sha256});}
  const saved=editionInfo(w,result.edition.id);assert.equal(saved.collectionBinding.collectionId,result.collectionId);assert.equal(saved.workspaceRevision,result.edition.workspaceRevision);
  await helpers.exact(path.join(prepared.root,'cold-original-edition.json'),saved);
 }finally{w.close();}
 return directory;
}
async function operateCold(page,endpoint,prepared,result,helpers){
 const drainBackups=retainBrowserBackups(page,prepared);
 try{
  const phase=await progress(prepared.root,helpers),box=await open(page,endpoint);await listCollection(box,result.collectionId);await box.locator('[data-large-edition="'+result.edition.id+'"]').click();await idle(box);
  const old=await api(page,endpoint,'/large/editions/'+result.edition.id);await downloadEdition(page,box,prepared,old,helpers,'cold-original-edition');
  await screen(page,box,prepared.root,'cold-reopened-original-390.png',390);
  // A cold receiver creates its own new whole-project archive, retaining the
  // sender's immutable original population edition independently.
  let nextId=phase.cold_edition_id;
  const retained=await retainedAdmission(prepared,helpers,'cold-publication');
  if(retained){
   if(nextId)assert.equal(nextId,retained.request.id,'The cold publication checkpoint changed its original selected edition');
   await restore(page,box,prepared,retained.workingFile);await box.locator('[data-action=resume]').click();await idle(box);
   assert.equal(await box.locator('[data-pending]').isVisible(),false,'The original cold publication remains pending; retain and resume its exact request');
   nextId=retained.request.id;
  }else if(!nextId){
   const pattern=endpoint+'/api/measurement-workspace/large/collections/'+result.collectionId+'/publish';let caught=null,selected=null;
   const handler=async route=>{
    if(route.request().method()!=='POST'||selected)return route.continue();
    try{
     selected=route.request().postDataJSON();assert(/^[a-f0-9]{64}$/.test(selected.id));assert(Number.isSafeInteger(selected.expectedRevision));assert.deepEqual(selected.filters,{});
     await retainAdmission(page,prepared,helpers,'cold-publication',selected,{trackWorking:false});await route.continue();
    }catch(error){caught=error;await route.abort('failed').catch(()=>{});}
   };
   await page.route(pattern,handler);
   try{
    await box.locator('[data-publish="'+result.collectionId+'"]').click();await idle(box);if(caught)throw caught;
    assert(selected,'The original receiver publication was not admitted');assert.equal(await box.locator('[data-pending]').isVisible(),false,'The original cold publication remains pending; retain and resume its exact request');
    nextId=selected.id;
   }finally{await page.unroute(pattern,handler);}
  }
  const edition=await api(page,endpoint,'/large/editions/'+nextId);
  assert.equal(edition.id,nextId);assert.equal(edition.collectionBinding.collectionId,result.collectionId);assert.notEqual(edition.id,result.edition.id);
  assert(Array.isArray(edition.files)&&edition.files.some(file=>file.path==='project.zip'),'The cold publication must return its complete bound project edition');
  await helpers.exact(path.join(prepared.root,'cold-current-edition.json'),edition);
  await progress(prepared.root,helpers,{cold_edition_id:nextId});
  await listCollection(box,result.collectionId);await box.locator('[data-large-edition="'+edition.id+'"]').click();await idle(box);
  await downloadEdition(page,box,prepared,edition,helpers,'cold-current-edition');
  await screen(page,box,prepared.root,'cold-current-edition-desktop.png',1440);await screen(page,box,prepared.root,'cold-current-edition-390.png',390);
  await drainBackups();await progress(prepared.root,helpers,{cold_browser_complete:true});return edition;
 }finally{await drainBackups();}
}
async function finish(prepared,result,helpers){
 const files=[];
 async function visit(directory,prefix=''){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
   const name=prefix+entry.name;
   if(entry.isDirectory()){if(!['owned-workspace','cold-received'].includes(name))await visit(path.join(directory,entry.name),name+'/');continue;}
   if(!entry.isFile()||/\.pending$|\.download$/.test(name)||['progress.json','service-session.json','COMPLETE.json','ATTACHMENTS.json','ATTACHMENTS.html'].includes(name)||name.includes('service-stderr'))continue;
   files.push({path:name,...await digestFile(path.join(directory,entry.name))});
  }
 }
 await visit(prepared.root);files.sort((a,b)=>a.path.localeCompare(b.path));
 const manifest={schema:'upstate.large-collection-receiving-attachments/v1',selection:prepared.selection,collectionId:result.collectionId,editionId:result.edition.id,files,
  visualReview:'The producing receiver opens and personally inspects the retained desktop/390 images and every original output; the complete source/native operation and that viewing result stay in the existing Eco receiving thread.'};
 const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Complete collection receiving — TokenJunkieLabs</title><style>html{color-scheme:light;background:#fff;color:#20242a;font:15px/1.5 system-ui}body{max-width:1100px;margin:24px auto;padding:0 16px;color:#20242a;background:#fff}h1,h2,p,td,th{color:#20242a}table{border-collapse:collapse;width:100%;table-layout:fixed;background:#fff}td,th{border:1px solid #bbb;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#eee}a{color:#25384a}img{max-width:100%;height:auto}</style><h1>Complete original collection receiving</h1><p>Prepared by TokenJunkieLabs</p><p>'+escape(prepared.selection.interpretation)+'</p><p>Collection '+escape(result.collectionId)+'<br>Original saved edition '+escape(result.edition.id)+'</p><p>'+escape(manifest.visualReview)+'</p><table><thead><tr><th>Complete original output</th><th>Bytes and SHA-256</th></tr></thead><tbody>'+files.map(f=>'<tr><td><a href="'+escape(f.path)+'">'+escape(f.path)+'</a></td><td>'+f.bytes+'<br>'+escape(f.sha256)+'</td></tr>').join('')+'</tbody></table>'+files.filter(f=>f.path.endsWith('.png')).map(f=>'<h2>'+escape(f.path)+'</h2><img src="'+escape(f.path)+'" alt="'+escape(f.path)+'">').join('')+'</html>';
 await helpers.exact(path.join(prepared.root,'ATTACHMENTS.html'),html);files.push({path:'ATTACHMENTS.html',bytes:Buffer.byteLength(html),sha256:hash(html)});
 await helpers.exact(path.join(prepared.root,'ATTACHMENTS.json'),manifest);
 const completed={schema,status:'COMPLETE_NATIVE_AND_BROWSER',collectionId:result.collectionId,editionId:result.edition.id,source_sha256:prepared.selection.original_portable_sha256,attachment_manifest:'ATTACHMENTS.json',manifest_sha256:hash(json(manifest)),files,visualReview:manifest.visualReview};
 await helpers.exact(path.join(prepared.root,'COMPLETE.json'),completed);return completed;
}
/** Closing a failed browser must still drain the original server lifecycle. */
async function closeReceivingSession(browser,service,logFile,helpers){
 const errors=[];
 try{await browser?.close();}catch(error){errors.push(error);}
 try{await fs.writeFile(logFile,service.stderr());}catch(error){errors.push(error);}
 try{await helpers.stopServer(service);}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'The original receiving session shutdown reported an error.');
}
/** Same original receiver dispatch and injected process lifecycle. */
export async function runLargeCollectionReceiving(options,helpers){
 const prepared=await prepareLargeCollectionReceiving(options,helpers),done=path.join(prepared.root,'COMPLETE.json');
 if(await exists(done)){const value=JSON.parse(await fs.readFile(done,'utf8'));assert.equal((await digestFile(path.join(prepared.root,value.attachment_manifest))).sha256,value.manifest_sha256);for(const file of value.files)assert.deepEqual(await digestFile(path.join(prepared.root,file.path)),{bytes:file.bytes,sha256:file.sha256});return value;}
 const phase=await progress(prepared.root,helpers);let result=phase.browser_complete?await retainedSenderResult(prepared,helpers):null;
 if(result&&phase.cold_browser_complete)return finish(prepared,result,helpers);
 if(!options.playwright||!options.chromium)return {schema,status:'AWAITING_EXISTING_EQUIPPED_BROWSER',output:prepared.root,selection:prepared.selection,note:'The five complete original files and actual baseline are retained for the existing isolated receiving course.'};
 const {chromium}=await import(pathToFileURL(path.resolve(options.playwright)).href);
 if(!result){
  const service=await helpers.startServer(prepared.directory);let browser;
  try{
   browser=await chromium.launch({executablePath:path.resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
   const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
   result=await operateLargeCollectionReceiving({page:await context.newPage(),endpoint:service.endpoint,prepared,helpers});
  }finally{await closeReceivingSession(browser,service,path.join(prepared.root,'service-stderr.log'),helpers);}
 }
 const directory=await coldReceive(prepared,result,helpers);
 if(!(await progress(prepared.root,helpers)).cold_browser_complete){
  const service=await helpers.startServer(directory);let browser;
  try{
   browser=await chromium.launch({executablePath:path.resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
   const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});await operateCold(await context.newPage(),service.endpoint,prepared,result,helpers);
  }finally{await closeReceivingSession(browser,service,path.join(prepared.root,'cold-service-stderr.log'),helpers);}
 }
 return finish(prepared,result,helpers);
}
