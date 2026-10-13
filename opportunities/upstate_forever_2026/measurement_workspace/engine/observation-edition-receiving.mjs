/**
 * Callable Observation editions chapter for the SAME owned Measurements receiver.
 * Uses original collection/Workspace/edition engines and the caller's page/server.
 * The callable operate function uses the caller's page/server. The runner uses
 * only the existing receiver's injected lifecycle. Neither invents a relationship.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {MeasurementWorkspace} from './workspace.mjs';
import {collectionFromFiles,previewCollection,receiveCollection} from './collections.mjs';
import {observationEditionCatalogue,inspectObservationEdition,previewObservationEdition,readObservationEdition,observationEditionCSV,observationCalibration} from './observation_editions.mjs';
import {observationEditionHTML} from '../web/observation_editions.mjs';

const schema='upstate.observation-edition-receiving/v1';
const hash=v=>createHash('sha256').update(v).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const comparable=v=>({...v,createdAt:''});
const clean=v=>{const {reused,current_revision,...rest}=v;return rest;};
const order=rows=>rows.map(x=>JSON.stringify(x)).sort();
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function exists(file){try{await fs.access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function originalTables(a,b){
  for(const key of ['imports','records','import_records','stations','mappings','reviews','selected_versions'])
    assert.deepEqual(order(a.tables[key]),order(b.tables[key]),'Observation receiving changed original '+key);
  if(a.intake)assert.deepEqual(a.intake,b.intake,'Original intake history changed');
  for(const row of a.tables.exports)assert(b.tables.exports.some(x=>JSON.stringify(x)===JSON.stringify(row)),'An existing export changed');
  for(const row of a.tables.events)assert(b.tables.events.some(x=>JSON.stringify(x)===JSON.stringify(row)),'An original event changed');
}
async function portable(directory){const w=new MeasurementWorkspace(directory);try{return w.portable();}finally{w.close();}}
async function api(page,endpoint,suffix,method='GET',data){
  const response=await page.request.fetch(endpoint+'/api/measurement-workspace'+suffix,{method,...(data===undefined?{}:{data})});
  if(!response.ok())throw Error('Original Measurements '+method+' '+suffix+' failed ('+response.status()+'): '+await response.text());
  return response.json();
}
async function wait(box,text){
  await box.locator('[data-oe-status]').filter({hasText:text}).waitFor();
  await box.locator('[data-oe-action=refresh]:not([disabled])').waitFor();
}
async function open(page,endpoint){
  await page.goto(endpoint);
  await page.locator('[data-tab=observation-editions]').click();
  const box=page.locator('.observation-editions');await wait(box,'Original source catalogue');
  return box;
}
async function acceptDialog(page,operation,answer){
  const handler=dialog=>dialog.accept(answer);
  page.once('dialog',handler);
  try{return await operation();}finally{page.off('dialog',handler);}
}
async function saved(box,id){
  await acceptDialog(box.page(),()=>box.locator('[data-oe-saved="'+id+'"]').click());
  await wait(box,'Saved historical observation edition opened');
}
async function screen(page,box,root,name,width){
  await page.setViewportSize({width,height:width===390?844:1000});
  await box.locator('details').evaluateAll(nodes=>nodes.forEach(n=>{n.open=true;}));
  await box.locator('[data-oe-action=edition-html]').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(root,name)});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Observation edition document overflows '+width+' px');
}
async function pendingDraft(root,label,request,helpers){
  const {operation_id,...value}=request;
  const draft={schema:'upstate.observation-edition-draft/v1',request:value,comparison:null,selected_ids:[],pending_save:request,retained_saves:[]};
  const filename=path.join(root,label+'-request-recovery.json');
  await helpers.exact(filename,draft);return filename;
}
async function recoverRequest(page,box,root,label,helpers){
  const request=JSON.parse(await fs.readFile(path.join(root,label+'-request.json'),'utf8'));
  const file=await pendingDraft(root,label,request,helpers);
  await acceptDialog(page,()=>box.locator('[data-oe-draft-file]').setInputFiles(file));
  await wait(box,'The complete draft is open');
  await box.locator('[data-oe-action=retry]').click();
  await wait(box,'recovered');
  return request;
}
async function selectPopulation(box,scope){
  for(const id of scope.source_ids)await box.locator('form[data-oe-form=scope] [name=source_id][value="'+id+'"]').check();
  for(const [name,value]of Object.entries(scope.filters))await box.locator('form[data-oe-form=scope] [name="'+name+'"]').fill(String(value));
  await box.locator('form[data-oe-form=scope]').getByRole('button',{name:'Inspect selected originals',exact:true}).click();
  await wait(box,'exact original records are ready');
}
async function applyChoices(page,box,choices){
  for(const group of choices.groups){
    await box.locator('[data-oe-action=clear-selection]').click();
    for(const id of group.member_ids){
      await box.locator('[data-oe-search]').fill(id);
      await box.locator('[data-oe-record-pick="'+id+'"]').check();
    }
    await box.locator('[data-oe-action=compare]').click();
    const form=box.locator('form[data-oe-form=relationship]');
    await form.locator('[name=relationship]').selectOption(group.relationship);
    if(group.representative_id)await form.locator('[name=representative_id]').selectOption(group.representative_id);
    await form.locator('[name=rationale]').fill(group.rationale);
    await form.locator('[name=evidence_reference]').fill(group.evidence_reference);
    for(const id of group.acknowledged_differences||[])await form.locator('[name=acknowledged_differences][value="'+id+'"]').check();
    await form.getByRole('button',{name:'Apply relationship to draft',exact:true}).click();
    await wait(box,'Relationship added to the unfinished edition');
  }
  for(const item of choices.exclusions){
    await box.locator('[data-oe-search]').fill(item.record_id);
    await acceptDialog(page,()=>box.locator('[data-oe-exclude="'+item.record_id+'"]').click(),item.reason);
  }
  await box.locator('[data-oe-search]').fill('');
}
async function fillReview(box,title,selection,purpose){
  const form=box.locator('form[data-oe-form=edition]');
  await form.locator('[name=title]').fill(title);
  await form.locator('[name=reviewer]').fill(selection.reviewer);
  await form.locator('[name=purpose]').fill(purpose);
}
/** Retain the ACTUAL outbound operation before dispatch. One deliberate lost ACK
 * exercises existing product recovery; it is not a new scientific failure. */
async function submit(page,box,endpoint,root,label,helpers,{loseAcknowledgement=false}={}){
  const file=path.join(root,label+'-request.json');
  if(await exists(file)){await recoverRequest(page,box,root,label,helpers);return;}
  let dispatched=false,routeError=null;
  const pattern=endpoint+'/api/measurement-workspace/observation-editions/editions';
  const handler=async route=>{
    if(route.request().method()!=='POST'||dispatched)return route.continue();
    dispatched=true;
    try{
      const request=route.request().postDataJSON();
      assert(request.operation_id&&request.source_binding,'The original UI did not send its exact operation binding');
      await helpers.exact(file,request);
      const response=await route.fetch();
      if(!response.ok()){await route.fulfill({response});return;}
      const edition=clean(await response.json());
      await helpers.exact(path.join(root,label+'-accepted.json'),edition);
      if(loseAcknowledgement)await route.abort('failed');else await route.fulfill({response});
    }catch(error){routeError=error;await route.abort('failed').catch(()=>{});}
  };
  await page.route(pattern,handler);
  try{
    await box.locator('form[data-oe-form=edition]').getByRole('button',{name:'Save observation edition',exact:true}).click();
    if(loseAcknowledgement)await box.locator('[data-oe-action=retry]:not([disabled])').waitFor();
    else await wait(box,'Observation edition saved');
    if(routeError)throw routeError;
    assert(dispatched,'The original UI save was not observed');
    assert(await exists(path.join(root,label+'-accepted.json')),'The original service did not accept this save; retain its exact request and inspect the returned error.');
  }finally{await page.unroute(pattern,handler);}
}
async function inspectAttachments(page,endpoint,box,edition,root,prefix,helpers){
  await saved(box,edition.edition_id);
  const expected={
    'edition-json':{name:prefix+'.json',body:json(edition)},
    'edition-csv':{name:prefix+'-occurrences.csv',body:observationEditionCSV(edition)},
    'edition-html':{name:prefix+'.html',body:observationEditionHTML(edition)},
    'calibration':{name:prefix+'-calibration.json',object:observationCalibration(edition)}
  };
  for(const [action,item]of Object.entries(expected)){
    const bytes=await helpers.captureDownload(page,root,item.name,()=>box.locator('[data-oe-action="'+action+'"]').click());
    if(item.object)assert.deepEqual(JSON.parse(bytes.toString('utf8')),item.object);
    else assert.equal(bytes.toString('utf8'),item.body,'Original '+action+' export differs');
  }
  for(const [i,source]of edition.capture.sources.entries()){
    const name=prefix+'-source-'+String(i+1).padStart(3,'0')+'-'+source.id+'.txt';
    const bytes=await helpers.captureDownload(page,root,name,()=>box.locator('[data-source="'+i+'"]').click());
    assert.equal(hash(bytes),source.sha);
    assert.equal(bytes.toString('utf8'),source.content);
  }
  await screen(page,box,root,prefix+'-desktop.png',1440);
  await screen(page,box,root,prefix+'-390.png',390);
  const offline=await page.context().newPage();
  try{
    await offline.goto(pathToFileURL(path.join(root,prefix+'.html')).href);
    await offline.locator('#observation-edition-data').waitFor({state:'attached'});
    assert.deepEqual(JSON.parse(await offline.locator('#observation-edition-data').textContent()),edition);
    const bytes=await helpers.captureDownload(offline,root,prefix+'-offline.json',()=>offline.locator('#json').click());
    assert.deepEqual(JSON.parse(bytes.toString('utf8')),edition);
    for(const [i,source]of edition.capture.sources.entries()){
      const bytes=await helpers.captureDownload(offline,root,prefix+'-offline-source-'+String(i+1).padStart(3,'0')+'.txt',()=>offline.locator('[data-source="'+i+'"]').click());
      assert.equal(hash(bytes),source.sha);
    }
    await offline.locator('details').evaluateAll(nodes=>nodes.forEach(n=>{n.open=true;}));
    await offline.setViewportSize({width:390,height:844});
    await offline.screenshot({path:path.join(root,prefix+'-offline-390.png')});
    assert(await offline.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Offline review overflows 390 px');
  }finally{await offline.close();}
}
async function retainCollections(prepared,root,options,helpers){
  const descriptors=[];
  if(!options.observationCollections)return descriptors;
  const raw=await helpers.regular(path.resolve(options.observationCollections)),paths=JSON.parse(raw.toString('utf8'));
  assert(Array.isArray(paths)&&paths.length&&paths.every(x=>typeof x==='string'),'Use a JSON array of complete original collection.json paths');
  await helpers.exact(path.join(root,'selected-collection-paths.json'),raw);
  const workspace=new MeasurementWorkspace(prepared.directory);
  try{
    const before=workspace.portable(),known=new Set(before.tables.imports.map(x=>x.id));
    for(const [index,filename]of paths.entries()){
      const selected=await fs.realpath(path.resolve(filename)),manifestRaw=await helpers.regular(selected),manifest=JSON.parse(manifestRaw.toString('utf8'));
      const input=collectionFromFiles(manifest,path.dirname(selected)),preview=previewCollection(workspace,input);
      for(const f of preview.files)if(f.importId)assert(known.has(f.importId),'Receive this original collection through the existing CLI before creating the input portable: '+f.path);
      const result=receiveCollection(workspace,{...input,expectedId:preview.id});
      const prefix='original-collections/'+String(index+1).padStart(2,'0')+'-'+result.id;
      await helpers.exact(path.join(root,prefix,'collection.json'),manifestRaw);
      const files=[];
      for(const f of input.files){
        const bytes=Buffer.from(f.base64,'base64');
        await helpers.exact(path.join(root,prefix,f.path),bytes);
        files.push({path:prefix+'/'+f.path,bytes:bytes.length,sha256:hash(bytes),original_path:f.path});
      }
      descriptors.push({id:result.id,title:input.title,prefix,manifest_sha256:hash(manifestRaw),files});
    }
    assert.deepEqual(comparable(workspace.portable()),comparable(before),'Restoring unchanged collection companions must not change the source snapshot');
  }finally{workspace.close();}
  return descriptors;
}
async function prepare(prepared,options,helpers){
  const root=path.join(prepared.root,'observation-editions');await fs.mkdir(root,{recursive:true});
  await helpers.assertOwnedTree(root);
  const collections=await retainCollections(prepared,root,options,helpers);
  const beforePath=path.join(root,'original-workspace.json');
  let before;
  if(await exists(beforePath))before=JSON.parse(await fs.readFile(beforePath,'utf8'));
  else{before=await portable(prepared.directory);await helpers.exact(beforePath,before);}
  originalTables(before,await portable(prepared.directory));
  const choices=options.observationChoices?JSON.parse((await helpers.regular(path.resolve(options.observationChoices))).toString('utf8')):{groups:[],exclusions:[]};
  assert(choices&&Array.isArray(choices.groups)&&Array.isArray(choices.exclusions),'Explicit observation choices require groups and exclusions arrays');
  const workspace=new MeasurementWorkspace(prepared.directory);
  let catalog,scope,capture;
  try{
    catalog=observationEditionCatalogue(workspace);
    scope={source_ids:choices.source_ids||catalog.sources.filter(x=>x.kind==='wqp').map(x=>x.id),filters:choices.filters||{}};
    capture=inspectObservationEdition(workspace,{scope});
    assert(capture.records.length,'Select an actual retained measurement population; station metadata alone cannot exercise this chapter.');
    // Validation uses the ORIGINAL compiler, never inferred identity or altered eligibility.
    previewObservationEdition(workspace,{scope:capture.scope,title:choices.title||'Original observations — receiving edition',reviewer:prepared.selection.reviewer,purpose:choices.purpose||prepared.selection.reason,groups:choices.groups,exclusions:choices.exclusions,expected_revision:capture.workspace_revision,source_binding:capture.source_binding,parent_id:null,parent_digest:null});
  }finally{workspace.close();}
  const selection={schema,original_portable_sha256:hash(json(before)),source_ids:capture.scope.source_ids,filters:capture.scope.filters,
    reviewer:prepared.selection.reviewer,reason:prepared.selection.reason,title:choices.title||'Original observations — receiving edition',
    revision_title:choices.revision_title||'Original observations — reviewed continuation',purpose:choices.purpose||prepared.selection.reason,
    groups:choices.groups,exclusions:choices.exclusions,collections,
    interpretation:choices.groups.length?'Only the supplied explicit, source-referenced relationship choices are applied.':'No cross-source relationship is asserted. Every original record remains accounted for; its original eligibility is unchanged.'};
  await helpers.exact(path.join(root,'selection.json'),selection);
  return {...prepared,root,before,selection,scope:capture.scope,capture,collections};
}

/** Operate within a caller-owned isolated page and the EXISTING server. */
export async function operateObservationEditionReceiving({page,endpoint,prepared,helpers}){
  const {root,before,selection}=prepared;
  assert.deepEqual(comparable(await api(page,endpoint,'/portable')),comparable(await portable(prepared.directory)),'The page does not serve the selected owned native workspace.');
  const progressFile=path.join(root,'progress.json');
  let progress=await exists(progressFile)?JSON.parse(await fs.readFile(progressFile,'utf8')):{};
  const saveProgress=async patch=>{progress={...progress,...patch};await helpers.atomic(progressFile,progress);};
  if(progress.browser_complete){
    const first=await api(page,endpoint,'/observation-editions/editions/'+progress.first_id),second=await api(page,endpoint,'/observation-editions/editions/'+progress.second_id);
    await helpers.exact(path.join(root,'first-edition.json'),first);await helpers.exact(path.join(root,'second-edition.json'),second);
    assert(await exists(path.join(root,'editable-workspace.json')),'The completed browser phase must retain its complete portable download.');
    const returned=await retainedPortable(page,endpoint,null,root,helpers);originalTables(before,returned);
    return {first,second,portable:returned,progress,errors:[]};
  }
  const errors=[],onError=e=>errors.push(String(e));page.on('pageerror',onError);
  let box=await open(page,endpoint);
  try{
    if(!progress.first_recovered){
      if(!await exists(path.join(root,'first-request.json'))){
        await selectPopulation(box,prepared.scope);
        const recordId=await box.locator('[data-oe-open]').first().getAttribute('data-oe-open');
        await helpers.exact(path.join(root,'inspected-original-record.json'),await api(page,endpoint,'/records/'+encodeURIComponent(recordId)));
        await box.locator('[data-oe-open="'+recordId+'"]').click();
        await page.locator('#mw-inspector .mw-mono').filter({hasText:recordId}).waitFor();
        await page.locator('#mw-inspector details').evaluateAll(nodes=>nodes.forEach(n=>{n.open=true;}));
        await page.setViewportSize({width:1440,height:1000});await page.locator('#mw-inspector').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(root,'original-record-desktop.png')});
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'original-record-390.png')});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Original inspector overflows 390 px');
        await page.locator('[data-tab=observation-editions]').click();box=page.locator('.observation-editions');
        await wait(box,'Unfinished observation choices restored');
        await applyChoices(page,box,selection);
        await fillReview(box,selection.title,selection,selection.purpose);
        await helpers.captureDownload(page,root,'first-unfinished-draft.json',()=>box.locator('[data-oe-action=draft]').first().click());
        await submit(page,box,endpoint,root,'first',helpers,{loseAcknowledgement:true});
      }else{
        const request=JSON.parse(await fs.readFile(path.join(root,'first-request.json'),'utf8'));
        await box.locator('[data-oe-draft-file]').setInputFiles(await pendingDraft(root,'first',request,helpers));
        await wait(box,'The complete draft is open');
      }
      const pendingPath=path.join(root,'first-pending-draft.json');
      const pending=await exists(pendingPath)?await fs.readFile(pendingPath):await helpers.captureDownload(page,root,'first-pending-draft.json',()=>box.locator('[data-oe-action=draft]').first().click());
      const pendingBody=JSON.parse(pending.toString('utf8')),request=JSON.parse(await fs.readFile(path.join(root,'first-request.json'),'utf8'));
      assert.deepEqual(pendingBody.pending_save,request);
      await acceptDialog(page,()=>box.locator('[data-oe-action=retain-pending]').click());
      await wait(box,'Exact request retained for recovery');
      const retainedPath=path.join(root,'first-retained-draft.json');
      const retained=await exists(retainedPath)?await fs.readFile(retainedPath):await helpers.captureDownload(page,root,'first-retained-draft.json',()=>box.locator('[data-oe-action=draft]').first().click());
      assert.deepEqual(JSON.parse(retained.toString('utf8')).retained_saves,[request]);
      await page.locator('[data-tab=exports]').click();
      await page.locator('[data-tab=observation-editions]').click();box=page.locator('.observation-editions');
      await wait(box,'Unfinished observation choices restored');
      assert.equal(await box.locator('[data-oe-recover]').count(),1);
      // The downloaded product draft reopens in a genuinely new browser page.
      const fresh=await page.context().newPage();
      try{
        const receiving=await open(fresh,endpoint);
        await receiving.locator('[data-oe-draft-file]').setInputFiles(path.join(root,'first-retained-draft.json'));
        await wait(receiving,'The complete draft is open');
        await receiving.locator('[data-oe-recover="0"]').click();await wait(receiving,'recovered');
        const saved=await api(fresh,endpoint,'/observation-editions/editions/observation-edition-'+hash(request.operation_id));
        await helpers.exact(path.join(root,'first-edition.json'),saved);
      }finally{await fresh.close();}
      await saveProgress({first_recovered:true,first_id:'observation-edition-'+hash(request.operation_id)});
      // Abandon no unresolved request: the original page is closed/reloaded only after exact recovery.
      box=await acceptDialog(page,()=>open(page,endpoint));
    }
    const first=await api(page,endpoint,'/observation-editions/editions/'+progress.first_id);
    await helpers.exact(path.join(root,'first-edition.json'),first);
    if(!progress.second_saved){
      await saved(box,first.edition_id);
      if(await exists(path.join(root,'second-request.json')))await recoverRequest(page,box,root,'second',helpers);
      else{
        await box.locator('[data-oe-action=revise]').click();await wait(box,'New revision opened');
        await fillReview(box,selection.revision_title,selection,selection.purpose+' — continued review; original rows and supplied scientific decisions retained.');
        await helpers.captureDownload(page,root,'revision-unfinished-draft.json',()=>box.locator('[data-oe-action=draft]').first().click());
        await submit(page,box,endpoint,root,'second',helpers);
      }
      const request=JSON.parse(await fs.readFile(path.join(root,'second-request.json'),'utf8'));
      await saveProgress({second_saved:true,second_id:'observation-edition-'+hash(request.operation_id)});
    }
    const second=await api(page,endpoint,'/observation-editions/editions/'+progress.second_id);
    assert.equal(second.parent_id,first.edition_id);assert.equal(second.parent_digest,first.digest);
    assert.deepEqual(second.groups,first.groups);assert.deepEqual(second.exclusions,first.exclusions);
    await helpers.exact(path.join(root,'second-edition.json'),second);
    assert.deepEqual(await api(page,endpoint,'/observation-editions/editions/'+first.edition_id),first,'Later revision rewrote historical source');
    await inspectAttachments(page,endpoint,box,first,root,'first-review',helpers);
    await inspectAttachments(page,endpoint,box,second,root,'second-review',helpers);
    const returned=await retainedPortable(page,endpoint,box,root,helpers);originalTables(before,returned);
    await box.locator('[data-oe-action=exports]').click();await page.locator('[data-tab=observation-editions]').click();
    box=page.locator('.observation-editions');await wait(box,'Original source catalogue');
    await saved(box,first.edition_id);
    assert.deepEqual(await api(page,endpoint,'/observation-editions/editions/'+first.edition_id),first);
    await screen(page,box,root,'historical-return-390.png',390);
    assert.deepEqual(errors,[],'Actual Observation edition browser exception');
    await saveProgress({browser_complete:true});
    return {first,second,portable:returned,progress,errors};
  }finally{page.off('pageerror',onError);}
}
async function retainedPortable(page,endpoint,box,root,helpers){
  const filename=path.join(root,'editable-workspace.json');
  const bytes=await exists(filename)?await helpers.regular(filename):await helpers.captureDownload(page,root,'editable-workspace.json',()=>box.locator('[data-oe-action=portable]').click());
  const retained=JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(comparable(retained),comparable(await api(page,endpoint,'/portable')),'The retained portable differs from the current original workspace; preserve both states and review before continuing.');
  return retained;
}
async function cold(prepared,result,helpers){
  const directory=path.join(prepared.root,'cold-received');await fs.mkdir(directory,{recursive:true});await helpers.assertOwnedTree(directory);
  const reaches=path.join(prepared.directory,'reaches.json');
  if(await exists(reaches))await helpers.exact(path.join(directory,'reaches.json'),await helpers.regular(reaches));
  const workspace=new MeasurementWorkspace(directory);
  try{
    if(!workspace.summary().imports.length)workspace.receive(result.portable);
    originalTables(result.portable,workspace.portable());
    assert.deepEqual(order(workspace.portable().tables.exports),order(result.portable.tables.exports));
    for(const collection of prepared.collections){
      const root=path.join(prepared.root,collection.prefix),manifest=JSON.parse(await fs.readFile(path.join(root,'collection.json'),'utf8'));
      receiveCollection(workspace,collectionFromFiles(manifest,root));
    }
    assert.deepEqual(readObservationEdition(workspace,result.first.edition_id),result.first);
    assert.deepEqual(readObservationEdition(workspace,result.second.edition_id),result.second);
    await helpers.exact(path.join(prepared.root,'cold-received-summary.json'),workspace.summary());
  }finally{workspace.close();}
  return directory;
}
async function finish(prepared,result,helpers){
  const files=[];const root=prepared.root;
  async function visit(directory,prefix=''){
    for(const e of await fs.readdir(directory,{withFileTypes:true})){
      const name=prefix+e.name;
      if(e.isDirectory()){if(name!=='cold-received')await visit(path.join(directory,e.name),name+'/');continue;}
      if(!e.isFile()||/\.pending$|\.download$/.test(name)||['COMPLETE.json','ATTACHMENTS.json','ATTACHMENTS.html','progress.json','service-session.json'].includes(name)||(name.startsWith('service-')||name==='cold-service-stderr.log'))continue;
      const bytes=await fs.readFile(path.join(directory,e.name));files.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
    }
  }
  await visit(root);files.sort((a,b)=>a.path.localeCompare(b.path));
  const manifest={schema:'upstate.observation-edition-receiving-attachments/v1',source:prepared.selection,editions:[result.first.edition_id,result.second.edition_id],files,
    visual_review:'Pending personal viewing of actual images and every output by the producing receiver. Automated source/native assertions do not establish visual acceptance.'};
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Observation editions — complete original receiving</title><style>html{background:#fff;color:#222;color-scheme:light;font:15px/1.5 system-ui}body{max-width:1100px;margin:24px auto;padding:0 18px}td,th{padding:8px;border:1px solid #bbb;text-align:left;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;table-layout:fixed}p,h1{overflow-wrap:anywhere}img{max-width:100%}</style><h1>Observation editions — original source and complete receiving</h1><p>'+escape(prepared.selection.interpretation)+'</p><p>First: '+escape(result.first.edition_id)+'<br>Revision: '+escape(result.second.edition_id)+'</p><p>'+escape(manifest.visual_review)+'</p><table><thead><tr><th>Complete original output</th><th>Bytes / SHA-256</th></tr></thead><tbody>'+files.map(f=>'<tr><td><a href="'+escape(f.path)+'">'+escape(f.path)+'</a></td><td>'+f.bytes+'<br>'+escape(f.sha256)+'</td></tr>').join('')+'</tbody></table>'+files.filter(f=>f.path.endsWith('.png')).map(f=>'<h2>'+escape(f.path)+'</h2><img src="'+escape(f.path)+'" alt="'+escape(f.path)+'">').join('')+'</html>';
  await helpers.exact(path.join(root,'ATTACHMENTS.html'),html);
  files.push({path:'ATTACHMENTS.html',bytes:Buffer.byteLength(html),sha256:hash(html)});
  await helpers.exact(path.join(root,'ATTACHMENTS.json'),manifest);
  const complete={schema,status:'COMPLETE_NATIVE_AND_BROWSER',editions:manifest.editions,counts:[result.first.counts,result.second.counts],
    source_sha256:prepared.selection.original_portable_sha256,attachment_manifest:'ATTACHMENTS.json',manifest_sha256:hash(json(manifest)),files,visual_review:manifest.visual_review};
  await helpers.exact(path.join(root,'COMPLETE.json'),complete);return complete;
}

/** Called ONLY by the existing reconciliation-receiving lifecycle/CLI. */
export async function runObservationEditionReceiving(options,helpers){
  const original=await helpers.prepareSourceVersionReceiving(options),prepared=await prepare(original,options,helpers);
  const done=path.join(prepared.root,'COMPLETE.json');
  if(await exists(done)){const result=JSON.parse(await fs.readFile(done,'utf8'));assert.equal(hash(await fs.readFile(path.join(prepared.root,result.attachment_manifest))),result.manifest_sha256);for(const file of result.files)assert.equal(hash(await fs.readFile(path.join(prepared.root,file.path))),file.sha256);return result;}
  if(!options.playwright||!options.chromium)return {schema,status:'AWAITING_EXISTING_EQUIPPED_BROWSER',output:prepared.root,selection:prepared.selection,note:'Exact original inputs are retained. This chapter uses the existing receiver process lifecycle only when its isolated browser paths are supplied.'};
  const {chromium}=await import(pathToFileURL(path.resolve(options.playwright)).href);
  let browser,result;const service=await helpers.startServer(prepared.directory);
  try{
    browser=await chromium.launch({executablePath:path.resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    result=await operateObservationEditionReceiving({page:await context.newPage(),endpoint:service.endpoint,prepared,helpers});
  }finally{await browser?.close();browser=null;try{await fs.writeFile(path.join(prepared.root,'service-stderr.log'),service.stderr());}finally{await helpers.stopServer(service);}}
  const directory=await cold(prepared,result,helpers);
  if(result.progress.cold_browser_complete)return finish(prepared,result,helpers);
  const receiving=await helpers.startServer(directory);
  try{
    browser=await chromium.launch({executablePath:path.resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}),page=await context.newPage(),box=await open(page,receiving.endpoint);
    for(const edition of [result.first,result.second]){
      await saved(box,edition.edition_id);
      assert.deepEqual(await api(page,receiving.endpoint,'/observation-editions/editions/'+edition.edition_id),edition);
    }
    await screen(page,box,prepared.root,'cold-received-390.png',390);
    const bytes=await helpers.captureDownload(page,prepared.root,'cold-received-edition.json',()=>box.locator('[data-oe-action=edition-json]').click());
    assert.deepEqual(JSON.parse(bytes.toString('utf8')),result.second);
  }finally{await browser?.close();try{await fs.writeFile(path.join(prepared.root,'cold-service-stderr.log'),receiving.stderr());}finally{await helpers.stopServer(receiving);}}
  await helpers.atomic(path.join(prepared.root,'progress.json'),{...result.progress,cold_browser_complete:true});
  return finish(prepared,result,helpers);
}
