#!/usr/bin/env node
// MIT. Original municipal requests and work orders through the full saved operating desk.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const time=()=>new Date().toISOString();
const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
const localTime=value=>new Date(value).toISOString().slice(0,16);
const originalTime=value=>{
  if(typeof value!=='string')return null;
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(value)?value.replace(' ','T').replace(' UTC','Z'):value;
  return Number.isFinite(Date.parse(normalized))?new Date(normalized).toISOString():null;
};

export async function runFollowThrough(config){
  const product=resolve(config.product),output=resolve(config.output),api=await import(pathToFileURL(join(product,'index.mjs')));
  const {canonical}=await import(pathToFileURL(join(product,'../gis/shared.mjs')));
  const equal=(a,b,message)=>requireValue(canonical(a)===canonical(b),message);
  const journey={schema:'commons.municipal-follow-through-operation.v1',runId:randomUUID(),startedAt:time(),state:'running',
    productEdition:config.productEdition,sourceEdition:config.sourceEdition,node:process.version,scenarios:[],phases:[],files:[],browserErrors:[]};
  const saved=new Set(),scenarioResults=[];
  let browser,sender,receiver,provider,reopened;
  await mkdir(output,{recursive:true,mode:0o700});
  for(const name of ['inputs','downloads','screenshots','merchant-exports'])await mkdir(join(output,name),{mode:0o700});
  async function record(name,contentType='application/octet-stream'){
    requireValue(!saved.has(name),'An operating output name was reused: '+name);
    const bytes=await readFile(join(output,name));saved.add(name);
    journey.files.push({name,bytes:bytes.length,sha256:hash(bytes),contentType});return bytes;
  }
  async function save(name,value,contentType='application/json'){
    await mkdir(dirname(join(output,name)),{recursive:true,mode:0o700});
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:json(value));
    await writeFile(join(output,name),bytes,{flag:'wx',mode:0o600});await record(name,contentType);return bytes;
  }
  function phase(name,result){const value={name,completedAt:time(),...result};journey.phases.push(value);console.log('FOLLOW_THROUGH_PHASE '+JSON.stringify(value));}
  async function screenshot(page,name){await page.screenshot({path:join(output,'screenshots',name),fullPage:true});await record('screenshots/'+name,'image/png');}
  async function settled(page){
    await page.waitForFunction(()=>document.getElementById('main')?.getAttribute('aria-busy')==='false');
  }
  async function revision(page,value){
    await page.waitForFunction(expected=>new RegExp('Edition\\s+'+expected+'\\b').test(document.getElementById('workspace-revision')?.textContent||''),value);
    await page.locator('.pending-status').waitFor({state:'detached'});await settled(page);
  }
  async function submit(page,path,action){
    const pending=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST');pending.catch(()=>{});
    await action();const response=await pending,result=await response.json();
    requireValue(response.ok()&&result.ok!==false,path+': '+json(result.error||result));
    const value=Object.hasOwn(result,'value')?result.value:result;
    if(Number.isSafeInteger(value.revision))await revision(page,value.revision);
    return value;
  }
  async function navigate(page,view,selector){
    await page.locator('.sidebar a[data-view="'+view+'"]').click();
    await page.waitForFunction(expected=>document.querySelector('.sidebar [aria-current="page"]')?.dataset.view===expected,view);
    await page.locator(selector).waitFor({state:'visible'});await settled(page);
  }
  async function download(page,locator,name){
    const pending=page.waitForEvent('download');pending.catch(()=>{});await locator.click();const file=await pending,problem=await file.failure();
    requireValue(!problem,'The original browser download failed for '+name+': '+problem);
    await file.saveAs(join(output,name));return record(name);
  }
  async function inspectSelectedFile(page,item){
    await submit(page,'/api/inspect-source',()=>page.locator('#source-file').setInputFiles(item.path));
    await page.waitForFunction(filename=>document.querySelector('#source-form')?.dataset.filename===filename&&!['none','loading'].includes(document.querySelector('#source-form')?.dataset.inspectionState||'none'),basename(item.path));
    if(item.captureIds?.length){
      for(const id of item.captureIds){
        const field=page.locator('input[data-capture="'+id+'"]');
        if(await field.count()&&!await field.isChecked()){await submit(page,'/api/inspect-source',()=>field.check());await page.waitForFunction(()=>!['none','loading'].includes(document.querySelector('#source-form')?.dataset.inspectionState||'none'));}
      }
      const selected=await page.locator('input[data-capture]:checked').evaluateAll(nodes=>nodes.map(x=>x.dataset.capture));
      for(const id of selected)if(!item.captureIds.includes(id)){await submit(page,'/api/inspect-source',()=>page.locator('input[data-capture="'+id+'"]').uncheck());await page.waitForFunction(()=>!['none','loading'].includes(document.querySelector('#source-form')?.dataset.inspectionState||'none'));}
    }
    await page.locator('#source-form button[type="submit"]').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#source-form button[type="submit"]')?.disabled===false);
  }
  async function importSource(page,item){
    await navigate(page,'sources','#source-form');await inspectSelectedFile(page,item);
    if(item.metadataPath){await submit(page,'/api/inspect-source',()=>page.locator('#metadata-file').setInputFiles(item.metadataPath));await page.waitForFunction(()=>!['none','loading'].includes(document.querySelector('#source-form')?.dataset.inspectionState||'none'));}
    const form=page.locator('#source-form');
    await form.locator('select[name="role"]').selectOption(item.role);
    await form.locator('input[name="name"]').fill(item.name);
    await form.locator('input[name="seriesId"]').fill(item.seriesId);
    await form.locator('input[name="observedAt"]').fill(localTime(item.observedAt));
    await form.locator('input[name="sourceUrl"]').fill(item.sourceUrl||'');
    const result=await submit(page,'/api/import',()=>form.locator('button[type="submit"]').click()),source=result.source;
    const original=sender.workspace.exportFile({kind:'source',sourceId:source.id});
    requireValue(hash(Buffer.from(original.body))===item.sha256,'The saved original source differs: '+item.key);
    requireValue(source.state===item.state,'The original source state differs: '+item.key);
    requireValue(source.rows===item.rows,'The complete original population differs: '+item.key);
    return source;
  }
  async function saveProfile(page,profile){
    await navigate(page,'profiles','#profile-form');
    await page.locator('[data-action="new-profile"]').click();
    await page.locator('#profile-editor-mode').selectOption('json');
    await page.locator('#profile-json').waitFor({state:'visible'});
    await page.locator('#profile-json').fill(json(profile));
    return (await submit(page,'/api/profile',()=>page.locator('#profile-form button[type="submit"]').click())).profile;
  }
  async function build(page,name,seriesId,profileId,requestSourceId,orderSourceId,asOf,commentary){
    await navigate(page,'requests','#edition-selection');
    const form=page.locator('#build-form'),container=page.locator('details').filter({has:form});
    if(!await form.isVisible())await container.locator('summary').click();
    await form.locator('input[name="name"]').fill(name);await form.locator('input[name="seriesId"]').fill(seriesId);
    await form.locator('select[name="requestSourceId"]').selectOption(requestSourceId);
    await form.locator('select[name="orderSourceId"]').selectOption(orderSourceId||'');
    await form.locator('select[name="profileId"]').selectOption(profileId);await form.locator('input[name="asOf"]').fill(localTime(asOf));
    await form.locator('textarea[name="commentary"]').fill(commentary||'');
    return (await submit(page,'/api/build',()=>form.locator('button[type="submit"]').click())).edition;
  }
  async function chooseEdition(page,id){
    await navigate(page,'requests','#edition-selection');await page.locator('#edition-selection').selectOption(id);
    await page.waitForFunction(id=>document.querySelector('#main')?.dataset.editionId===id,id);await settled(page);
  }
  async function showComparison(page,before,after,entity='requests'){
    await navigate(page,'changes','#change-before');
    for(const [selector,value]of [['#change-before',before],['#change-after',after],['#change-entity',entity]]){
      if(await page.locator(selector).inputValue()!==value){
        const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/changes');response.catch(()=>{});
        await page.locator(selector).selectOption(value);const result=await response;requireValue(result.ok(),'The browser could not read the selected complete source comparison.');await settled(page);
      }
    }
    await page.waitForFunction(({before,after,entity})=>document.querySelector('#change-before')?.value===before&&document.querySelector('#change-after')?.value===after&&document.querySelector('#change-entity')?.value===entity,{before,after,entity});
    await settled(page);
  }
  async function allRequests(editionId,limit=11){
    const items=[];let offset=0;
    for(;;){const page=sender.workspace.requests({editionId,offset,limit});items.push(...page.items);offset+=page.items.length;if(offset>=page.total)break;requireValue(page.items.length>0,'The original request page ended before its complete population.');}
    requireValue(new Set(items.map(r=>r.key)).size===items.length,'The source request pages repeated a normalized identity.');return items;
  }
  async function browseAllRequests(page,edition){
    await chooseEdition(page,edition.id);await page.locator('[data-action="clear-filters"]').click();await settled(page);await page.locator('#page-size').selectOption('10');await settled(page);
    const keys=[];
    for(;;){
      keys.push(...await page.locator('#main [data-action="request-detail"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.key)));
      const next=page.locator('[data-action="request-next"]');if(await next.isDisabled())break;
      const previous=await page.locator('.table-footer>span').innerText();await next.click();
      await page.waitForFunction(previous=>document.querySelector('.table-footer>span')?.textContent!==previous,previous);await settled(page);
    }
    requireValue(keys.length===edition.rows&&new Set(keys).size===edition.rows,'The browser omitted or repeated an original request across pages.');
    return keys;
  }
  async function openRequest(page,editionId,row){
    await chooseEdition(page,editionId);await page.locator('#request-query').fill(String(row.serviceRequestId));
    await page.waitForFunction(key=>!!document.querySelector('#main [data-action="request-detail"][data-key="'+key+'"]'),row.key);
    await page.locator('#main [data-action="request-detail"][data-key="'+row.key+'"]').click();
    await page.locator('#work-form').waitFor({state:'visible'});
    requireValue((await page.locator('#detail-title').innerText()).includes(String(row.serviceRequestId)),'The browser opened a different original request.');
  }
  async function saveInternalWork(page,row,index,scenario,approval='approved'){
    await openRequest(page,scenario.edition.id,row);const form=page.locator('#work-form');
    await form.locator('select[name="status"]').selectOption('assigned');
    await form.locator('input[name="assignee"]').fill('Commons municipal integration desk');
    await form.locator('select[name="priority"]').selectOption(row.workNeeded==='needed'?'high':'normal');
    await form.locator('textarea[name="note"]').fill('Internal technical commissioning of the complete public source edition. Original city status and comments remain unchanged.');
    await form.locator('select[name="action"]').selectOption('reconcile');
    await form.locator('textarea[name="actionNote"]').fill('Reconcile service '+String(row.serviceRequestId)+' against the retained source, preserve its original '+String(row.sourceStatus)+' status and review the available work-order references before operational use.');
    await form.locator('input[name="reviewer"]').fill('8E5F internal technical review');
    await form.locator('select[name="approval"]').selectOption(approval);
    const result=await submit(page,'/api/work',()=>form.locator('button[type="submit"]').click());
    await page.locator('#close-detail').click();return result.work;
  }
  async function selectDecision(page,id,choice){
    await page.locator('input[data-proposal="'+id+'"][value="'+choice+'"]').check();
    await page.waitForFunction(({id,choice})=>{
      return new Promise((resolve,reject)=>{
        const r=indexedDB.open('open311-service-follow-through',1);r.onerror=()=>reject(r.error);
        r.onsuccess=()=>{const db=r.result,tx=db.transaction('saved'),cursor=tx.objectStore('saved').openCursor();let found=false;
          cursor.onsuccess=()=>{const c=cursor.result;if(!c){db.close();resolve(found);return;}if(String(c.key).startsWith('drafts:directory:')&&c.value?.review?.choices?.values?.[id]===choice)found=true;c.continue();};cursor.onerror=()=>{db.close();reject(cursor.error);};};
      });
    },{id,choice});
  }
  async function chooseApproved(page,editionId,ids){
    await navigate(page,'dispatch','#edition-selection');await page.locator('#edition-selection').selectOption(editionId);await settled(page);
    await page.locator('[data-action="clear-approved"]').click();
    const requested=new Set(ids),seen=new Set();
    for(;;){
      const available=await page.locator('input[data-select-work]').evaluateAll(nodes=>nodes.map(n=>n.dataset.selectWork));
      for(const id of available)if(requested.has(id)){await page.locator('input[data-select-work="'+id+'"]').check();seen.add(id);}
      const next=page.locator('[data-action="approved-next"]');if(!await next.count()||await next.isDisabled())break;
      const before=await page.locator('.table-footer').first().innerText();await next.click();await page.waitForFunction(before=>document.querySelector('.table-footer')?.textContent!==before,before);await settled(page);
    }
    equal([...seen].sort(),[...requested].sort(),'The approved action selection omitted a requested current action.');
  }

  try{
    requireValue(Array.isArray(config.scenarios)&&config.scenarios.length>0,'Select at least one complete original city scenario.');
    const sourceSpecs=new Map();
    for(const scenario of config.scenarios){
      for(const item of scenario.sources){
        requireValue(!sourceSpecs.has(item.key),'Original source keys must be unique across city scenarios.');
        const bytes=await readFile(resolve(item.path));requireValue(bytes.length===item.bytes&&hash(bytes)===item.sha256,'The exact retained source input differs: '+item.key);
        const filename='inputs/'+item.key+'.json';await save(filename,bytes);
        const retained={...item,path:join(output,filename),originalText:bytes.toString('utf8')};
        if(item.metadataPath){const metadata=await readFile(resolve(item.metadataPath));requireValue(hash(metadata)===item.metadataSha256,'The original layer metadata differs: '+item.key);const metadataName='inputs/'+item.key+'-metadata.json';await save(metadataName,metadata);retained.metadataPath=join(output,metadataName);}
        const inspected=api.inspectSource(retained.originalText,{...(item.captureIds?{captureIds:item.captureIds}:{}),...(item.kind?{kind:item.kind}:{}),...(item.metadataPath?{metadataText:await readFile(retained.metadataPath,'utf8')}:{})});
        requireValue(inspected.state===item.state&&inspected.rows===item.rows,'The original input coverage differs from its selected source definition: '+item.key);
        sourceSpecs.set(item.key,retained);
      }
    }
    journey.originalInputs=[...sourceSpecs.values()].map(({key,name,bytes,sha256,role,state,rows,captureIds,sourceUrl,observedAt})=>({key,name,bytes,sha256,role,state,rows,captureIds,sourceUrl,observedAt}));
    const senderDirectory=join(output,'sender-workspace'),receiverDirectory=join(output,'receiver-workspace');
    for(const directory of [senderDirectory,receiverDirectory]){const w=api.openWorkspace(directory);w.close();}
    sender=await api.serveFollowThrough({directory:senderDirectory});receiver=await api.serveFollowThrough({directory:receiverDirectory});
    const originalReceiverId=receiver.workspace.state().workspaceId;
    const importedPlaywright=await import(pathToFileURL(config.playwrightModule)),{chromium}=importedPlaywright.default??importedPlaywright;
    browser=await chromium.launch({executablePath:config.chromiumExecutablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'UTC',acceptDownloads:true}),page=await context.newPage();
    page.setDefaultTimeout(config.timeoutMs??45000);page.on('pageerror',error=>journey.browserErrors.push({page:'sender',message:error.message,stack:error.stack}));
    await page.goto(sender.url,{waitUntil:'domcontentloaded'});await page.locator('#main h1').filter({hasText:'Service follow-through'}).waitFor();await settled(page);

    for(const specification of config.scenarios){
      const scenario={key:specification.key,name:specification.name,sources:[],editions:[]},sources=new Map();
      for(const source of specification.sources){const result=await importSource(page,sourceSpecs.get(source.key));sources.set(source.key,result);scenario.sources.push(result);}
      await screenshot(page,specification.key+'-01-original-sources.png');
      phase('original-city-source-import',{scenario:specification.key,sources:scenario.sources.map(s=>({id:s.id,name:s.name,state:s.state,rows:s.rows}))});
      const profile=await saveProfile(page,specification.profile);
      scenario.profile=profile;
      let edition=await build(page,specification.name+' original follow-through',specification.seriesId,profile.key||profile.id+'@'+profile.revision,
        sources.get(specification.requestSourceKey).id,specification.orderSourceKey?sources.get(specification.orderSourceKey).id:null,
        specification.asOf,'Complete original city source edition for internal technical commissioning. Saved actions are internal operating work.');
      scenario.edition=edition;scenario.editions.push(edition);
      requireValue(edition.rows===specification.rows,'The operating edition changed the original request population.');
      let rows=await allRequests(edition.id),orderedKeys=await browseAllRequests(page,edition);
      equal([...orderedKeys].sort(),rows.map(r=>r.key).sort(),'The browser and native request selections differ.');
      if(specification.locatedRows!==undefined)requireValue(rows.filter(r=>r.geometry).length===specification.locatedRows,'The source location coverage differs.');
      const requestSource=sender.workspace.workspaceExport().records.find(r=>r.kind==='source'&&r.id===sources.get(specification.requestSourceKey).id).value,originalRows=api.originalRows(requestSource);
      for(const row of rows){const detail=sender.workspace.request({editionId:edition.id,key:row.key});requireValue(originalRows.some(original=>canonical(original.original)===canonical(detail.request.original)),'A normalized request has no identical retained original feature.');}
      await page.locator('[data-action="clear-filters"]').click();await settled(page);await screenshot(page,specification.key+'-02-service-follow-through.png');
      const selected=[...rows.filter(r=>r.workNeeded==='needed'),...rows].filter((r,i,a)=>a.findIndex(x=>x.key===r.key)===i).slice(0,3);
      requireValue(selected.length===3,'The original city edition needs three real requests for the internal operating sequence.');
      for(const [index,row]of selected.entries())await saveInternalWork(page,row,index,scenario);

      if(specification.pagedRequestSourceKey){
        const prior=edition;edition=await build(page,specification.name+' complete paged follow-through',specification.seriesId,profile.key||profile.id+'@'+profile.revision,
          sources.get(specification.pagedRequestSourceKey).id,specification.orderSourceKey?sources.get(specification.orderSourceKey).id:null,
          specification.asOf,'The independently captured original pages cover the complete selected source interval.');
        scenario.edition=edition;scenario.editions.push(edition);const compared=sender.workspace.changes({before:prior.id,after:edition.id,offset:0,limit:1000});
        if(specification.pagedEquivalent===true)requireValue(compared.summary.unchanged===specification.rows&&compared.summary.added===0&&compared.summary.changed===0&&compared.summary.notObserved===0,'The complete original page union differs from its single-response source.');
        await showComparison(page,prior.id,edition.id,'requests');
        await screenshot(page,specification.key+'-03-original-source-comparison.png');
        const carry=sender.workspace.workQueue({editionId:edition.id,approval:'approved',offset:0,limit:1000});
        requireValue(carry.total===3&&carry.items.every(w=>w.approvalCurrent),'Unchanged original source work did not carry into the later edition.');
        phase('complete-original-page-comparison',{scenario:specification.key,before:prior.id,after:edition.id,summary:compared.summary,carriedApprovedActions:carry.total});
        rows=await allRequests(edition.id);
      }


      if(specification.pagedOrderSourceKey){
        const prior=edition;edition=await build(page,specification.name+' complete paged work-order edition',specification.seriesId,profile.key||profile.id+'@'+profile.revision,
          sources.get(specification.pagedRequestSourceKey||specification.requestSourceKey).id,sources.get(specification.pagedOrderSourceKey).id,
          specification.asOf,'Complete independently captured order pages retain original source-generated identifiers and every original business field.');
        scenario.edition=edition;scenario.editions.push(edition);
        const pages=[];let offset=0,summary;
        for(;;){const current=sender.workspace.changes({before:prior.id,after:edition.id,entity:'orders',offset,limit:7});summary=current.summary;pages.push(...current.items);if(current.nextOffset===null)break;requireValue(Number.isSafeInteger(current.nextOffset)&&current.nextOffset>offset,'The original order comparison did not advance.');offset=current.nextOffset;}
        requireValue(summary.added===0&&summary.notObserved===0&&summary.changed===specification.orderMetadataOnlyChanges&&summary.sourceMetadataOnly===specification.orderMetadataOnlyChanges,'The original order page comparison differs from the retained complete municipal responses.');
        requireValue(pages.length===specification.orderMetadataOnlyChanges&&pages.every(row=>row.entity==='orders'&&row.sourceMetadataOnly===true&&row.fields.every(field=>field==='ESRI_OID')),'The order page comparison changed a municipal business field or lost an original generated identifier.');
        await showComparison(page,prior.id,edition.id,'orders');await screenshot(page,specification.key+'-03c-original-work-order-comparison.png');
        if(pages.length){await page.locator('[data-action="change-detail"]').first().click();await page.locator('#detail-dialog').waitFor({state:'visible'});await screenshot(page,specification.key+'-03d-original-order-values.png');await page.locator('#close-detail').click();}
        const source=sender.workspace.workspaceExport().records.find(r=>r.kind==='source'&&r.id===sources.get(specification.pagedOrderSourceKey).id).value,originals=api.originalRows(source);
        const orders=[];offset=0;for(;;){const current=sender.workspace.orders({editionId:edition.id,offset,limit:11});orders.push(...current.items);if(current.nextOffset===null)break;requireValue(Number.isSafeInteger(current.nextOffset)&&current.nextOffset>offset,'The complete original order pages did not advance.');offset=current.nextOffset;}
        requireValue(orders.length===sources.get(specification.pagedOrderSourceKey).rows,'The paged operating edition lost an original work order.');
        for(const order of orders)requireValue(originals.some(row=>canonical(row.original)===canonical(order.original)),'A normalized work order lost its full original paged feature.');
        const carry=sender.workspace.workQueue({editionId:edition.id,approval:'approved',offset:0,limit:1000});requireValue(carry.total===3&&carry.items.every(w=>w.approvalCurrent),'Unchanged request assignments did not carry through a later unlinked order edition.');
        phase('complete-original-order-page-comparison',{scenario:specification.key,before:prior.id,after:edition.id,summary,changedOriginalRows:pages.length,unchangedBusinessFields:orders.length,orders:orders.length,carriedApprovedActions:carry.total});
        rows=await allRequests(edition.id);
      }

      if(specification.closureRequestSourceKey){
        const closure=await build(page,specification.name+' original closure-date cohort',specification.seriesId,profile.key||profile.id+'@'+profile.revision,
          sources.get(specification.closureRequestSourceKey).id,specification.orderSourceKey?sources.get(specification.orderSourceKey).id:null,
          specification.asOf,'Original requests selected by their source closing date. This source covers its explicit closure-time interval.');
        scenario.editions.push(closure);
        const comparison=sender.workspace.changes({before:edition.id,after:closure.id,offset:0,limit:1000});
        if(specification.closureRows!==undefined)requireValue(closure.rows===specification.closureRows,'The complete original closure-date population differs.');
        await showComparison(page,edition.id,closure.id,'requests');
        await screenshot(page,specification.key+'-03b-actual-closure-cohort.png');
        phase('actual-closure-date-source-comparison',{scenario:specification.key,before:edition.id,after:closure.id,summary:comparison.summary,sourceCoverage:comparison.scope});
      }

      if(specification.orderSourceKey){
        const orders=sender.workspace.orders({editionId:edition.id,offset:0,limit:13});
        requireValue(orders.total===sources.get(specification.orderSourceKey).rows,'The actual order source population changed during normalization.');
        if(orders.items.length){
          await openRequest(page,edition.id,selected[0]);await page.locator('#order-query').fill(String(orders.items[0].workOrderId));
          const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders');response.catch(()=>{});await page.locator('[data-action="search-orders"]').click();await response;await page.locator('[data-action="select-link-order"][data-order-key="'+orders.items[0].key+'"]').waitFor();
          await page.locator('[data-action="select-link-order"][data-order-key="'+orders.items[0].key+'"]').click();await page.locator('#link-form').waitFor({state:'visible'});
          await screenshot(page,specification.key+'-04-original-work-order-review.png');await page.locator('#close-detail').click();
        }
        const nullReferences=rows.filter(r=>Object.values(r.referenceValues||{}).every(value=>value===null||value==='')).length;
        phase('original-work-order-search',{scenario:specification.key,orders:orders.total,separateRequestIdentities:rows.length,requestsWithEmptyReferences:nullReferences});
      }

      await chooseEdition(page,edition.id);
      const reviewBytes=await download(page,page.locator('[data-action="export"][data-kind="review"]').first(),'downloads/'+specification.key+'-editable-review.json');
      const review=JSON.parse(reviewBytes.toString('utf8'));review.reviewer='8E5F internal desk review';review.notes='Internal operating review of unchanged original municipal source records.';
      for(const [index,row]of selected.entries()){
        const item=review.work.find(item=>item.key===row.key);requireValue(item,'The complete editable review omitted an original request.');
        item.after.actionNote='Internal review '+(index+1)+': retain service '+String(row.serviceRequestId)+' and its complete original comments; reconcile the selected municipal source references before operational delivery.';
        item.after.approval='approved';item.after.reviewer='8E5F internal desk review';
      }
      await save('inputs/'+specification.key+'-returned-review.json',review);
      await navigate(page,'work','#review-import-form');await page.locator('#review-file').setInputFiles(join(output,'inputs',specification.key+'-returned-review.json'));
      await page.waitForFunction(()=>document.querySelector('#review-import-form button[type="submit"]')?.disabled===false);
      const importedReturn=(await submit(page,'/api/review-import',()=>page.locator('#review-import-form button[type="submit"]').click())).returned;
      await page.locator('#return-selection').selectOption(importedReturn.id);await page.locator('#review-target-edition').selectOption(edition.id);await settled(page);
      const returned=sender.workspace.returned(importedReturn.id,{targetEditionId:edition.id});
      requireValue(returned.proposals.length===3&&returned.unchanged===specification.rows-3,'The returned original review changed a different request population.');
      const proposals=selected.map(row=>returned.proposals.find(p=>p.key===row.key));
      for(const p of proposals)requireValue(p&&p.conflicts.length===0,'A source-bound returned change lost its original request or saved assignment.');
      await selectDecision(page,proposals[0].id,'accept');await selectDecision(page,proposals[2].id,'reject');
      await page.locator('#review-apply-form input[name="reviewer"]').fill('8E5F internal desk review');
      await page.locator('#review-apply-form textarea[name="note"]').fill('Apply the first reviewed internal action and reject the third proposed edit; keep the second open for a separate decision.');
      await submit(page,'/api/review-apply',()=>page.locator('#review-apply-form button[type="submit"]').click());
      let remaining=sender.workspace.returned(importedReturn.id,{targetEditionId:edition.id});
      requireValue(remaining.proposals.filter(p=>p.status==='pending').length===1,'Partial review decisions did not leave exactly the selected remaining proposal.');
      await selectDecision(page,proposals[1].id,'accept');await page.reload({waitUntil:'domcontentloaded'});
      await page.locator('input[data-proposal="'+proposals[1].id+'"][value="accept"]').waitFor();
      requireValue(await page.locator('input[data-proposal="'+proposals[1].id+'"][value="accept"]').isChecked(),'The remaining selected review decision was lost on reload.');
      await page.locator('#review-apply-form input[name="reviewer"]').fill('8E5F internal desk review');
      await page.locator('#review-apply-form textarea[name="note"]').fill('Apply the remaining selected internal action after reopening the saved review.');
      await submit(page,'/api/review-apply',()=>page.locator('#review-apply-form button[type="submit"]').click());
      remaining=sender.workspace.returned(importedReturn.id,{targetEditionId:edition.id});
      requireValue(remaining.pending===0&&remaining.proposals.filter(p=>p.status==='accepted').length===2&&remaining.proposals.filter(p=>p.status==='rejected').length===1,'The full returned review did not retain its two accepted and one rejected decisions.');
      await screenshot(page,specification.key+'-05-returned-review.png');
      const reviewedWork=selected.slice(0,2).map(row=>sender.workspace.request({editionId:edition.id,key:row.key}).work);
      await chooseApproved(page,edition.id,reviewedWork.map(w=>w.id));
      await page.locator('#dispatch-form input[name="name"]').fill(specification.name+' internal service follow-through');
      const columns=[
        {name:'service_request',source:'request',field:'serviceRequestId'},
        {name:'original_status',source:'request',field:'sourceStatus'},
        {name:'original_description',source:'request',field:'description'},
        {name:'related_order_ids',source:'order',field:'workOrderId'},
        {name:'internal_action',source:'work',field:'action'},
        {name:'internal_action_note',source:'work',field:'actionNote'},
        {name:'assigned_team',source:'work',field:'assignee'},
        {name:'internal_reviewer',source:'work',field:'reviewer'}
      ];
      await page.locator('#dispatch-form textarea[name="columns"]').fill(json(columns));
      await page.locator('#dispatch-form textarea[name="note"]').fill('Selected internal technical review actions over complete original public municipal sources. The source status remains literal.');
      const dispatch=(await submit(page,'/api/dispatch',()=>page.locator('#dispatch-form button[type="submit"]').click())).dispatch;
      await page.locator('#dispatch-selection').selectOption(dispatch.id);await settled(page);
      const actualDispatch=sender.workspace.dispatch(dispatch.id);requireValue(actualDispatch.rows.length===2,'The reviewed dispatch changed its explicit two-action selection.');
      equal(actualDispatch.rows.map(r=>r.work.id).sort(),reviewedWork.map(w=>w.id).sort(),'The dispatch includes another saved action.');
      for(const [kind,extension]of [['dispatch-json','json'],['dispatch-csv','csv'],['dispatch-geojson','geojson'],['report','html']]){
        const bytes=await download(page,page.locator('[data-action="export"][data-kind="'+kind+'"][data-dispatch-id="'+dispatch.id+'"]'),'downloads/'+specification.key+'-reviewed-dispatch.'+extension);
        requireValue(bytes.equals(Buffer.from(sender.workspace.exportFile({kind,dispatchId:dispatch.id}).body)),'The browser dispatch differs from the original saved file.');
      }
      await screenshot(page,specification.key+'-06-reviewed-dispatch.png');
      scenario.returned=remaining;scenario.dispatch=dispatch;scenarioResults.push(scenario);
      journey.scenarios.push({key:scenario.key,name:scenario.name,sources:scenario.sources.map(s=>({id:s.id,name:s.name,state:s.state,rows:s.rows})),profileId:profile.key,editions:scenario.editions,review:importedReturn.id,dispatch});
      phase('reviewed-city-workspace-complete',{scenario:scenario.key,requests:edition.rows,approvedSelectedActions:actualDispatch.rows.length,acceptedReviewChanges:2,rejectedReviewChanges:1,dispatchId:dispatch.id});
      await save('downloads/'+specification.key+'-complete-operating-workspace.json',Buffer.from(sender.workspace.exportFile({kind:'workspace'}).body));
    }

    await navigate(page,'overview','#main h1');await screenshot(page,'all-cities-operating-overview.png');
    const senderBytes=await download(page,page.locator('#download-workspace'),'downloads/municipal-follow-through-complete-workspace.json');
    const senderPackage=JSON.parse(senderBytes.toString('utf8'));api.validateWorkspacePackage(senderBytes.toString('utf8'));
    equal(senderPackage.records,sender.workspace.workspaceExport().records,'The browser complete handover omitted an original source or saved work record.');
    const receivingPage=await context.newPage();receivingPage.setDefaultTimeout(config.timeoutMs??45000);receivingPage.on('pageerror',error=>journey.browserErrors.push({page:'receiver',message:error.message,stack:error.stack}));
    await receivingPage.goto(receiver.url,{waitUntil:'domcontentloaded'});await navigate(receivingPage,'receiving','#receiving-form');
    await receivingPage.locator('#receiving-file').setInputFiles(join(output,'downloads','municipal-follow-through-complete-workspace.json'));
    await receivingPage.waitForFunction(()=>document.querySelector('#receiving-form button[type="submit"]')?.disabled===false);
    let receivingInput,committedReceiving;let resolveInterrupted,rejectInterrupted;
    const interrupted=new Promise((resolve,reject)=>{resolveInterrupted=resolve;rejectInterrupted=reject;});interrupted.catch(()=>{});
    await receivingPage.route('**/api/receive',async route=>{
      try{
        receivingInput=route.request().postDataJSON();const response=await route.fetch();const result=await response.json();
        requireValue(response.ok()&&result.ok!==false,'The receiving operation did not commit: '+json(result));
        committedReceiving=result.value??result;await route.abort('failed');resolveInterrupted();
      }catch(error){rejectInterrupted(error);await route.abort('failed').catch(()=>{});}
    });
    await receivingPage.locator('#receiving-form button[type="submit"]').click();await interrupted;
    requireValue(committedReceiving.workspaceId===senderPackage.workspaceId&&receiver.workspace.state().workspaceId!==originalReceiverId,'The original complete handover was not adopted before the interrupted response.');
    await receivingPage.reload({waitUntil:'domcontentloaded'});await revision(receivingPage,committedReceiving.revision);
    const recovered=receiver.workspace.operation(receivingInput.requestId);
    equal(recovered.result,committedReceiving,'The original receiving result changed during browser recovery.');
    equal(receiver.workspace.workspaceExport().records,senderPackage.records,'The receiving directory changed the complete original operating records.');
    for(const operation of senderPackage.operations)equal(receiver.workspace.operation(operation.requestId),operation,'An original saved action changed while receiving.');
    requireValue(!Object.hasOwn(recovered.input,'originalText')&&recovered.input.originalFile?.sha256===hash(senderBytes),'The receiving operation did not retain the compact identity of the complete original input.');
    await navigate(receivingPage,'overview','#main h1');await screenshot(receivingPage,'received-editable-municipal-workspace.png');
    await receivingPage.unroute('**/api/receive');
    const last=scenarioResults.at(-1),record=receiver.workspace.requests({editionId:last.edition.id,offset:0,limit:1}).items[0];
    await openRequest(receivingPage,last.edition.id,record);const continuedForm=receivingPage.locator('#work-form');
    await continuedForm.locator('textarea[name="note"]').fill('Receiving operator reopened the complete original source and continued this internal assignment.');
    await continuedForm.locator('select[name="approval"]').selectOption('draft');
    await submit(receivingPage,'/api/work',()=>continuedForm.locator('button[type="submit"]').click());await receivingPage.locator('#close-detail').click();
    const receivedBytes=await download(receivingPage,receivingPage.locator('#download-workspace'),'downloads/municipal-follow-through-received-workspace.json');
    phase('complete-handover-receiving-and-continued-work',{originalInitializationId:originalReceiverId,workspaceId:senderPackage.workspaceId,receivingRequestId:receivingInput.requestId,receivingResult:committedReceiving,originalBytes:senderBytes.length,continuedBytes:receivedBytes.length});

    await browser.close();browser=null;await receiver.close();receiver=null;await sender.close();sender=null;
    reopened=api.openWorkspace(receiverDirectory,{create:false});
    for(const scenario of scenarioResults)requireValue(reopened.requests({editionId:scenario.edition.id,offset:0,limit:1}).total===scenario.edition.rows,'Native reopen lost an original city population.');
    const cold=Buffer.from(reopened.exportFile({kind:'workspace'}).body);await save('downloads/municipal-follow-through-reopened-workspace.json',cold);reopened.close();reopened=null;
    const cliDirectory=join(output,'cli-received-workspace'),cliRequestId=randomUUID();
    const cliResult=await execute(process.execPath,[join(product,'cli.mjs'),'receive','--workspace',cliDirectory,'--file',join(output,'downloads','municipal-follow-through-received-workspace.json'),'--request-id',cliRequestId,'--expected-revision','0'],{maxBuffer:8*1024*1024});
    const cli=JSON.parse(cliResult.stdout);await save('cli-receiving-result.json',cli);
    reopened=api.openWorkspace(cliDirectory,{create:false});const finalPackage=reopened.workspaceExport(),priorPackage=JSON.parse(receivedBytes.toString('utf8'));
    equal(finalPackage.records,priorPackage.records,'The installed command line changed prior operating records.');requireValue(finalPackage.workspaceId===senderPackage.workspaceId&&finalPackage.revision===priorPackage.revision+1,'The installed receiving hop changed the original workspace identity.');
    const cliBytes=Buffer.from(reopened.exportFile({kind:'workspace'}).body);await save('downloads/municipal-follow-through-cli-workspace.json',cliBytes);reopened.close();reopened=null;
    phase('native-reopen-and-command-line-receiving',{workspaceId:finalPackage.workspaceId,revision:finalPackage.revision,cliRequestId,bytes:cliBytes.length});
    if(config.merchant)await runMerchantReceiving({product,output,cliDirectory,cliBytes,cliRequestId,scenarioResults,api,save,phase,equal,requireValue,config});
    requireValue(journey.browserErrors.length===0,'The browser reported an application error.');
    journey.state='passed';
  }catch(error){
    journey.state='failed';journey.error={message:error.message,code:error.code,status:error.status,details:error.details,stack:error.stack};
    if(browser)try{for(const [index,page]of browser.contexts().flatMap(c=>c.pages()).entries())await screenshot(page,'failure-'+index+'.png');}catch(captureError){journey.captureError=captureError.message;}
  }finally{
    if(provider)await provider.close().catch(error=>{journey.closeError=error.message;});
    if(reopened)reopened.close();if(browser)await browser.close().catch(error=>{journey.closeError=error.message;});
    if(receiver)await receiver.close().catch(error=>{journey.closeError=error.message;});if(sender)await sender.close().catch(error=>{journey.closeError=error.message;});
    journey.completedAt=time();await writeFile(join(output,'operation.json'),json(journey),{flag:'wx',mode:0o600});
    console.log('FOLLOW_THROUGH_COMPLETE '+JSON.stringify({state:journey.state,output,scenarios:journey.scenarios.length,phases:journey.phases.length,files:journey.files.length,error:journey.error}));
  }
  return journey;
}

async function runMerchantReceiving(context){
  const {product,output,cliDirectory,cliBytes,cliRequestId,scenarioResults,save,phase,equal,requireValue,config}=context;
  const {MerchantOpen311FollowThroughWorkspaces,readFollowThroughWorkspaceConfiguration}=await import(pathToFileURL(join(product,'mcp.mjs')));
  const {Open311FollowThroughMerchantClient,FOLLOW_THROUGH_HOST_SCHEMA}=await import(pathToFileURL(join(product,'mcp-client.mjs')));
  const hostPath=join(output,'merchant-follow-through-host.json');
  await save('merchant-follow-through-host.json',{schema:FOLLOW_THROUGH_HOST_SCHEMA,workspaces:{recipient:{label:'Received municipal service follow-through',directory:cliDirectory,inputs:{original:{label:'Complete original operating workspace',path:join(output,'downloads','municipal-follow-through-complete-workspace.json'),sha256:hash(await readFile(join(output,'downloads','municipal-follow-through-complete-workspace.json'))),kind:'workspace',format:'json'}}}}});
  const host=await readFollowThroughWorkspaceConfiguration(hostPath),provider=new MerchantOpen311FollowThroughWorkspaces({open311FollowThroughWorkspaces:host,exportsDirectory:join(output,'merchant-exports')});
  try{
    const client=new Open311FollowThroughMerchantClient((name,args)=>provider.call(name,args),'recipient'),status=await client.status();
    const populations=[];
    for(const scenario of scenarioResults){
      const items=[];let offset=0;
      for(;;){const page=await client.requests({editionId:scenario.edition.id,expectedRevision:status.revision,offset,limit:11});items.push(...page.items);if(page.nextOffset===null)break;requireValue(Number.isInteger(page.nextOffset)&&page.nextOffset>offset,'The merchant source page did not advance.');offset=page.nextOffset;}
      requireValue(items.length===scenario.edition.rows&&new Set(items.map(r=>r.key)).size===scenario.edition.rows,'The installed merchant client omitted an original city request.');populations.push({scenario:scenario.key,requests:items.length});
    }
    const file=await client.downloadFile({kind:'workspace',expectedRevision:status.revision},{limit:196608});requireValue(file.bytes.equals(cliBytes),'The installed merchant receiver changed the complete command-line handover.');await save('downloads/municipal-follow-through-merchant-workspace.json',file.bytes);
    const recovered=await client.operation(cliRequestId);requireValue(recovered?.state==='SUCCEEDED'&&recovered.result.workspaceId===status.workspaceId,'The merchant client could not recover the original command-line receiving action.');
    phase('installed-merchant-receiving',{workspaceId:status.workspaceId,revision:status.revision,populations,bytes:file.bytesRead,sha256:file.file.sha256,cliRequestId});
  }finally{await provider.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const result=await runFollowThrough(JSON.parse(await readFile(process.argv[2],'utf8')));if(result.state!=='passed')process.exitCode=1;
}
