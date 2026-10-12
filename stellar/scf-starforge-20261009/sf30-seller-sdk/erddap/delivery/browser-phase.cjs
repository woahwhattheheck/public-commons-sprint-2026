/* MIT. One real browser continuation over the original ERDDAP workspace and receiver. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createRequire}=require('node:module');
const readyPath=process.argv[2];
if(!readyPath)throw new Error('Pass the original private ready JSON.');
const ready=JSON.parse(fs.readFileSync(readyPath,'utf8'));
const requireRuntime=createRequire(__filename);
const playwrightModule=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?
  path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright') : 'playwright';
const {chromium}=requireRuntime(playwrightModule);
const playwrightVersion=requireRuntime(path.join(playwrightModule,'package.json')).version;
if((ready.handoffProfiles||[]).length){
  const version=playwrightVersion.split('.').map(Number);
  if(version[0]<1||(version[0]===1&&version[1]<51))
    throw new Error('The provider browser continuation needs the existing Playwright 1.51+ IndexedDB storage-state support.');
}
const out=ready.outputDirectory;
const resultPath=path.join(out,'browser-result.json'),privatePath=path.join(out,'browser-private.json');
function read(p,fallback){return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;}
function write(p,value){const temp=p+'.pending';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,p);}
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result=read(resultPath,{schema:'stellar-forge.erddap-browser-result.v1',completed:[],sources:[],builds:[],exports:[],receiving:[],errors:[],ssoStarts:undefined});
delete result.ssoStarts;
const saved=read(privatePath,{schema:'stellar-forge.erddap-browser-private.v1',inputManifestSha256:ready.inputManifestSha256,workspace:ready.workspace,receiver:ready.receiverWorkspace});
if(saved.inputManifestSha256!==ready.inputManifestSha256 || saved.workspace!==ready.workspace || saved.receiver!==ready.receiverWorkspace)
  throw new Error('The retained browser continuation belongs to another original workspace/input selection.');
if(saved.handoffManifestSha256&&saved.handoffManifestSha256!==ready.handoffManifestSha256)
  throw new Error('The retained provider browser continuation belongs to another exact profile selection.');
if((ready.handoffProfiles||[]).length)saved.handoffManifestSha256=ready.handoffManifestSha256;
let browser,context,page,currentPhase='open',requestErrors=[];
function safeUrl(url){try{return new URL(url).pathname;}catch{return '<unparsed>';}}
function checkpoint(){write(resultPath,result);write(privatePath,saved);}
async function preserveContext(){
  if(context){
    if(page&&!page.isClosed())await page.evaluate(async()=>{
      if(typeof persistHandoffDrafts==='function')await persistHandoffDrafts();
    });
    saved.storageState=await context.storageState({indexedDB:true});write(privatePath,saved);
  }
}
function attach(p){
  p.on('pageerror',error=>{result.errors.push({phase:currentPhase,type:'page',message:String(error.message).slice(0,1000)});});
  p.on('requestfailed',request=>{requestErrors.push({path:safeUrl(request.url()),error:request.failure()&&request.failure().errorText});requestErrors=requestErrors.slice(-20);});
}
async function phase(name,action){
  if(result.completed.includes(name))return;
  currentPhase=name;result.status='RUNNING';result.currentPhase=name;delete result.failure;checkpoint();
  await action();await preserveContext();result.completed.push(name);result.phaseSources[name]=result.currentSourceRevision;delete result.currentPhase;checkpoint();
  process.stdout.write(JSON.stringify({phase:name,complete:true})+'\n');
}
async function readyButton(selector){
  const loc=page.locator(selector).first();await loc.waitFor({state:'visible',timeout:120000});
  await page.waitForFunction(s=>{const e=document.querySelector(s);return e&&!e.disabled;},selector,{timeout:120000});
  return loc;
}
async function click(selector){await(await readyButton(selector)).click();}
async function nav(view){await click('[data-view="'+view+'"]');}
async function selectedSource(id){
  await page.waitForFunction(value=>{
    const row=document.querySelector('[data-action="select-source"][data-id="'+value+'"]');
    const action=document.querySelector('[data-action="default-mapping"]');
    return row&&row.getAttribute('aria-current')==='true'&&action&&!action.disabled;
  },id,{timeout:120000});
}
async function selectedBuild(id){
  await page.waitForFunction(value=>{
    const row=document.querySelector('[data-action="select-build"][data-id="'+value+'"]');
    const action=document.querySelector('[data-action="native-query"]');
    return row&&row.getAttribute('aria-current')==='true'&&action&&!action.disabled&&document.querySelector('#native-result');
  },id,{timeout:120000});
}
async function proposeMapping(id){
  await response('/api/sources/'+id+'/mapping','POST',()=>click('[data-action="default-mapping"]'));
  await page.waitForFunction(()=>{
    const dialog=document.querySelector('#review-dialog'),button=document.querySelector('[data-action="default-mapping"]');
    return dialog.open||(document.querySelector('#mapping-name')&&button&&!button.disabled);
  },null,{timeout:120000});
  if(await page.locator('#review-dialog').isVisible())await click('[data-action="confirm-review"]');
  await readyButton('[data-action="review-mapping"]');
}
async function response(route,method,action){
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname===route&&r.request().method()===method,{timeout:180000});
  await action();const r=await pending;const body=await r.json();
  if(!r.ok())throw new Error(route+' returned '+r.status()+': '+String(body.error||JSON.stringify(body)).slice(0,1500));
  return body;
}
async function open(url){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('#workspace-name').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Saved workspace opened.'||
    !document.querySelector('#error').hidden,{timeout:120000});
  const error=page.locator('#error');
  if(await error.isVisible())throw new Error(await error.innerText());
}
async function currentState(url){
  const u=new URL(url),token=u.hash.slice(1);u.hash='';
  const response=await context.request.get(new URL('/api/state',u).href,{headers:{Authorization:'Bearer '+token}});
  if(!response.ok())throw new Error('Original state read returned '+response.status());
  return response.json();
}
async function queryFirst(limit=1){
  await page.locator('#native-query').fill('limit='+limit);
  return response('/api/builds/'+result.currentBuild+'/query','GET',()=>click('[data-action="native-query"]'));
}
async function receiveDownload(action,name){
  const dest=path.join(out,name);
  const old=result.exports.find(x=>x.file===name);
  if(fs.existsSync(dest)&&old){
    if(old.sha256!==digest(dest)||old.bytes!==fs.statSync(dest).size)throw new Error('A completed original export changed: '+name);
    return old;
  }
  const pending=page.waitForEvent('download',{timeout:180000});
  await click('[data-action="'+action+'"]');
  const d=await pending,temporary=dest+'.download-'+crypto.randomUUID();await d.saveAs(temporary);
  const item={file:name,bytes:fs.statSync(temporary).size,sha256:digest(temporary)};
  if(fs.existsSync(dest)){
    if(digest(dest)!==item.sha256||fs.statSync(dest).size!==item.bytes)throw new Error('Unrecorded export conflicts with the same original response; both files remain retained: '+name);
    fs.unlinkSync(temporary);
  }else fs.renameSync(temporary,dest);
  if(old&&(old.sha256!==item.sha256||old.bytes!==item.bytes))throw new Error('Reopened export differs from its retained identity: '+name);
  if(!old)result.exports.push(item);checkpoint();return item;
}

function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function handoffContext(i){
  saved.handoffs=saved.handoffs||{};result.handoffs=result.handoffs||[];
  const input=ready.handoffProfiles[i];
  const current=saved.handoffs[i]||{sourceId:input.sourceId,inputSha256:input.sha256};
  if(current.sourceId!==input.sourceId||current.inputSha256!==input.sha256)throw new Error('This provider browser checkpoint belongs to another exact profile.');
  saved.handoffs[i]=current;return current;
}
async function handoffOpen(sourceId){
  await nav('handoffs');
  await page.locator('#handoff-source').waitFor({state:'visible'});
  await page.locator('#handoff-source').selectOption(sourceId);
  await click('[data-action="handoff-open-source"]');
  await page.waitForFunction(id=>{
    const editor=document.querySelector('#handoff-editor');
    const button=document.querySelector('[data-action="handoff-preview"]')||document.querySelector('[data-action="handoff-apply-json"]');
    return editor&&editor.dataset.source===id&&button&&!button.disabled;
  },sourceId,{timeout:120000});
}
async function handoffTab(name){
  await click('[data-action="handoff-tab"][data-tab="'+name+'"]');
  await page.waitForFunction(tab=>{
    const button=document.querySelector('[data-action="handoff-tab"][data-tab="'+tab+'"]');
    return button&&button.getAttribute('aria-selected')==='true'&&!button.disabled;
  },name,{timeout:120000});
}
async function handoffPreview(){
  const value=await response('/api/handoffs/previews','POST',()=>click('[data-action="handoff-preview"]'));
  await page.locator('#review-dialog[open]').waitFor({state:'visible',timeout:120000});
  return value;
}
async function handoffSelectedRevision(id){
  await page.waitForFunction(value=>{
    const selected=document.querySelector('#handoff-saved-revision'),button=document.querySelector('[data-action="handoff-export-review"]');
    return selected&&selected.dataset.id===value&&button&&!button.disabled;
  },id,{timeout:120000});
}
async function handoffRead(route,url=ready.original.url){
  const target=new URL(url),token=target.hash.slice(1);
  const response=await context.request.get(new URL('/api/handoffs'+(route?'/'+route:''),target).href,{headers:{Authorization:'Bearer '+token}});
  if(!response.ok())throw new Error('Original provider handoff read returned '+response.status()+': '+route);
  return response.json();
}
async function findOriginalHandoff(request){
  let offset=0,found=null;const visited=new Set();
  for(;;){
    if(visited.has(offset))throw new Error('Original provider history returned a repeated page.');
    visited.add(offset);
    const history=await handoffRead('history?source='+encodeURIComponent(request.source)+'&offset='+offset+'&limit=250');
    for(const item of history.revisions){
      if(item.parent!==request.expectedHead)continue;
      const record=await handoffRead('reviews/'+item.id);
      if(record.sourceId===request.source&&canonical(record.profile)===canonical(request.profile)){
        if(found&&found.id!==record.id)throw new Error('The same exact provider request resolved to multiple retained revisions.');
        found=record;
      }
    }
    if(history.nextOffset==null)return found;
    if(!Number.isSafeInteger(history.nextOffset)||history.nextOffset<=offset)throw new Error('Original provider history returned an invalid next page.');
    offset=history.nextOffset;
  }
}
function matchingHandoff(record,request){
  if(record.sourceId!==request.source||record.parent!==request.expectedHead||canonical(record.profile)!==canonical(request.profile))
    throw new Error('The recovered provider request changed its exact source, profile or original parent.');
  return record;
}
async function providerBrowser(){
  for(let i=0;i<(ready.handoffProfiles||[]).length;i++){
    const input=ready.handoffProfiles[i],memo=handoffContext(i),profile=input.profile;
    if(digest(input.path)!==input.sha256)throw new Error('The supplied original provider profile file changed.');
    if(crypto.createHash('sha256').update(canonical(profile)+'\n').digest('hex')!==input.profileSha256)
      throw new Error('The exact provider profile differs from the original owner selection.');
    await phase('provider_profile_'+i,async()=>{
      await handoffOpen(input.sourceId);
      if(!await page.locator('#handoff-json').isVisible()){
        await handoffTab('review');
        const details=page.locator('details').filter({has:page.locator('#handoff-json')});
        if(await details.getAttribute('open')===null)await details.locator('summary').click();
      }
      await page.locator('#handoff-json').fill(JSON.stringify(profile,null,2));
      const applied=await response('/api/handoffs/previews','POST',()=>click('[data-action="handoff-apply-json"]'));
      if(canonical(applied.profile)!==canonical(profile))throw new Error('The supplied original provider profile was changed by the editor.');
      await readyButton('[data-action="handoff-preview"]');
      await page.locator('#handoff-title').waitFor({state:'visible'});
      if(await page.locator('#handoff-title').inputValue()!==profile.title)throw new Error('The dataset title differs from the supplied provider profile.');
      await handoffTab('contacts');
      if(await page.locator('#handoff-contacts-technical-email').inputValue()!==profile.contacts.technical.email||
         await page.locator('#handoff-contacts-scientific-email').inputValue()!==profile.contacts.scientific.email)
        throw new Error('The supplied technical or scientific contact was changed by intake.');
      await page.locator('#handoff-license-attribution').fill(profile.license.attribution);
      await page.locator('#handoff-license-reviewed').setChecked(profile.license.reviewed);
      await handoffTab('time');
      await page.locator('#handoff-time-originalTimezone').fill(profile.time.originalTimezone);
      await page.locator('#handoff-time-reviewed').setChecked(profile.time.reviewed);
      if(await page.locator('#handoff-time-representation').inputValue()!==profile.time.representation)
        throw new Error('The actual time representation was changed by intake.');
      if(profile.stations.length){
        await handoffTab('stations');await click('[data-action="handoff-station"][data-index="0"]');
        if(await page.locator('#handoff-stations-0-id').inputValue()!==profile.stations[0].id)
          throw new Error('The literal original station identity differs.');
        await page.locator('#handoff-stations-0-notes').fill(profile.stations[0].notes);
        await page.locator('#handoff-stations-0-reviewed').setChecked(profile.stations[0].reviewed);
      }
      if(profile.variables.length){
        await handoffTab('variables');await click('[data-action="handoff-variable"][data-index="0"]');
        if(await page.locator('#handoff-variables-0-name').inputValue()!==profile.variables[0].name)
          throw new Error('The original provider variable name differs.');
        await page.locator('#handoff-variables-0-description').fill(profile.variables[0].description);
        await page.locator('#handoff-variables-0-reviewed').setChecked(profile.variables[0].reviewed);
        await page.locator('#handoff-quality-processing').fill(profile.quality.processing);
        await page.locator('#handoff-quality-reviewed').setChecked(profile.quality.reviewed);
      }
      await handoffTab('overview');
      memo.firstNotes=profile.notes+(profile.notes?'\n':'')+'Provider profile reviewed through the original ERDDAP operator.';
      memo.newerNotes=memo.firstNotes+'\nNewer operator draft retained during save-response recovery.';
      await page.locator('#handoff-notes').fill(memo.firstNotes);
      await click('[data-action="handoff-refresh"]');
      await page.waitForFunction(expected=>document.querySelector('#handoff-notes')?.value===expected&&
        document.querySelector('#status').textContent==='Saved provider revisions refreshed. Editor draft retained.',memo.firstNotes,{timeout:120000});
      result.handoffs[i]={sourceId:input.sourceId,inputSha256:input.sha256,profileSha256:input.profileSha256,
        rowCount:applied.review.rowCount,stationCount:applied.review.stationCount,initialReady:applied.review.ready,
        initialIssues:applied.review.issues.map(x=>({code:x.code,field:x.field,severity:x.severity,count:x.count}))};
      checkpoint();
    });
    await phase('provider_save_response_recovery_'+i,async()=>{
      await handoffOpen(input.sourceId);
      if(!memo.firstRequest){
        await handoffPreview();
        let settle,timer;
        const observed=new Promise(resolve=>{settle=resolve;});
        const routePattern='**/api/handoffs/reviews';
        const handler=async route=>{
          if(route.request().method()!=='POST'){await route.continue();return;}
          try{
            const body=route.request().postDataJSON();
            if(body.source!==input.sourceId)throw new Error('The intercepted save belongs to another source.');
            memo.firstRequest=body;checkpoint();await preserveContext();
            const actual=await route.fetch();const record=await actual.json();
            if(!actual.ok())throw new Error('Original provider save returned '+actual.status()+': '+String(record.error||''));
            memo.firstRevision=matchingHandoff(record,body);memo.responseInterrupted=true;checkpoint();
            await route.abort('failed');settle({record});
          }catch(error){try{await route.abort('failed');}catch(_){}settle({error});}
        };
        await page.route(routePattern,handler);
        try{
          await click('[data-action="confirm-review"]');
          const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({error:new Error('The original save response did not return; retain the same pending request.')}),180000);});
          const outcome=await Promise.race([observed,timeout]);
          if(outcome.error)throw outcome.error;
          await readyButton('[data-action="handoff-retry"]');
        }finally{clearTimeout(timer);await page.unroute(routePattern,handler);}
      }
      // The original pending control retains its exact profile and parent even
      // while the operator edits and reopens a newer browser draft.
      await handoffTab('overview');
      await page.locator('#handoff-notes').fill(memo.newerNotes);
      await click('[data-action="handoff-refresh"]');
      await page.waitForFunction(expected=>document.querySelector('#handoff-notes')?.value===expected&&
        document.querySelector('#status').textContent==='Saved provider revisions refreshed. Editor draft retained.',memo.newerNotes,{timeout:120000});
      await preserveContext();await open(ready.original.url);
      await handoffOpen(input.sourceId);await handoffTab('overview');
      if(await page.locator('#handoff-notes').inputValue()!==memo.newerNotes)throw new Error('The newer provider draft did not survive browser reopening.');
      if(await page.locator('[data-action="handoff-retry"]').count()){
        const actual=matchingHandoff(await response('/api/handoffs/reviews','POST',()=>click('[data-action="handoff-retry"]')),memo.firstRequest);
        if(memo.firstRevision&&actual.id!==memo.firstRevision.id)throw new Error('Original save recovery created a different provider revision.');
        memo.firstRevision=actual;checkpoint();
      }
      if(!memo.firstRevision){memo.firstRevision=await findOriginalHandoff(memo.firstRequest);checkpoint();}
      if(!memo.firstRevision)throw new Error('The original accepted provider save has not been recovered.');
      await handoffTab('review');
      await click('[data-action="handoff-revision"][data-id="'+memo.firstRevision.id+'"]');
      await handoffSelectedRevision(memo.firstRevision.id);
      const draft=JSON.parse(await page.locator('#handoff-json').inputValue());
      if(draft.notes!==memo.newerNotes)throw new Error('The save response replaced the newer provider draft.');
      const recovered=await findOriginalHandoff(memo.firstRequest);
      if(!recovered||recovered.id!==memo.firstRevision.id)throw new Error('The original accepted provider revision is not uniquely retained in history.');
      result.handoffs[i].firstRevision=memo.firstRevision.id;result.handoffs[i].firstParent=memo.firstRevision.parent;
      result.handoffs[i].firstReady=memo.firstRevision.review.ready;
      result.handoffs[i].sameSaveRecovered=true;result.handoffs[i].newerDraftPreserved=true;checkpoint();
    });
    await phase('provider_second_revision_'+i,async()=>{
      await handoffOpen(input.sourceId);
      if(!memo.secondRevision&&memo.secondRequest){
        if(await page.locator('[data-action="handoff-retry"]').count()){
          memo.secondRevision=matchingHandoff(await response('/api/handoffs/reviews','POST',()=>click('[data-action="handoff-retry"]')),memo.secondRequest);
          checkpoint();
        }else{memo.secondRevision=await findOriginalHandoff(memo.secondRequest);checkpoint();}
      }
      if(!memo.secondRevision){
        const preview=await handoffPreview();
        const requested={source:input.sourceId,profile:preview.profile,expectedHead:memo.firstRevision.id};
        if(memo.secondRequest&&canonical(requested)!==canonical(memo.secondRequest))
          throw new Error('The original second provider request differs from the retained editor; keep both for review.');
        if(preview.profile.notes!==memo.newerNotes)throw new Error('The next provider review lost the newer retained draft.');
        memo.secondRequest=requested;checkpoint();
        memo.secondRevision=matchingHandoff(await response('/api/handoffs/reviews','POST',()=>click('[data-action="confirm-review"]')),memo.secondRequest);
        checkpoint();
      }
      await handoffTab('review');
      await click('[data-action="handoff-revision"][data-id="'+memo.secondRevision.id+'"]');
      await handoffSelectedRevision(memo.secondRevision.id);
      await page.locator('#handoff-compare-before').selectOption(memo.firstRevision.id);
      await page.locator('#handoff-compare-after').selectOption(memo.secondRevision.id);
      await click('[data-action="handoff-compare"]');
      await page.locator('#review-dialog[open]').waitFor({state:'visible'});
      const comparison=await page.locator('#review-body').innerText();
      if(!comparison.includes('notes')||!comparison.includes(memo.newerNotes))throw new Error('The provider revision comparison omitted the actual draft change.');
      await click('[data-action="close-review"]');
      result.handoffs[i].secondRevision=memo.secondRevision.id;result.handoffs[i].secondReady=memo.secondRevision.review.ready;
      result.handoffs[i].revisionComparison=true;
    });
    await phase('provider_exports_'+i,async()=>{
      await handoffOpen(input.sourceId);await handoffTab('review');
      await click('[data-action="handoff-revision"][data-id="'+memo.firstRevision.id+'"]');await handoffSelectedRevision(memo.firstRevision.id);
      result.handoffs[i].reviewExport=await receiveDownload('handoff-export-review','handoff-review-'+i+'.zip');
      await click('[data-action="handoff-revision"][data-id="'+memo.secondRevision.id+'"]');await handoffSelectedRevision(memo.secondRevision.id);
      const mode=memo.secondRevision.review.ready?'ready':'review';
      if(mode==='review'&&!await page.locator('[data-action="handoff-export-ready"]').isDisabled())
        throw new Error('Ready export was enabled despite the retained provider review issue.');
      result.handoffs[i].secondExport=await receiveDownload('handoff-export-'+mode,'handoff-second-'+mode+'-'+i+'.zip');
      result.handoffs[i].secondExportMode=mode;result.handoffs[i].readyExportAvailable=memo.secondRevision.review.ready;
      result.handoffs[i].retainedReviewIssues=memo.secondRevision.review.issues.map(x=>({code:x.code,field:x.field,severity:x.severity,count:x.count}));
    });
  }
  if((ready.handoffProfiles||[]).length)await phase('provider_desktop_and_phone',async()=>{
    await handoffOpen(ready.handoffProfiles[0].sourceId);await handoffTab('stations');
    if(ready.screenshots)await page.screenshot({path:path.join(out,'provider-handoff-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    const dimensions=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
    if(dimensions.width>dimensions.viewport+1)throw new Error('The provider intake overflows the phone viewport.');
    if(ready.screenshots)await page.screenshot({path:path.join(out,'provider-handoff-phone.png'),fullPage:true});
    result.providerViewports={desktop:1440,phone:390,horizontalOverflow:false};await page.setViewportSize({width:1440,height:960});
  });
}
async function providerReceiveBrowser(){
  result.providerReceiving=result.providerReceiving||[];
  for(let i=0;i<(result.handoffs||[]).length;i++){
    const original=result.handoffs[i];
    const bundles=[
      {key:'reviewExport',revision:original.firstRevision,mode:'review',expectedReady:original.firstReady,label:'first-review'},
      {key:'secondExport',revision:original.secondRevision,mode:original.secondExportMode,expectedReady:original.secondReady,label:'second-'+original.secondExportMode}
    ];
    for(const selected of bundles){
      const item=original[selected.key],revision=selected.revision,mode=selected.mode;
      if(!item)throw new Error('The original reviewed provider export has not completed.');
      await phase('provider_customer_receive_'+i+'_'+selected.label,async()=>{
        await nav('handoffs');
        if(await page.locator('[data-action="handoff-tab"][data-tab="review"]').count())await handoffTab('review');
        const filename=path.join(out,item.file);
        if(digest(filename)!==item.sha256)throw new Error('The original provider export changed before receiving.');
        await page.locator('#handoff-receive-file').setInputFiles(filename);
        const value=await response('/api/handoffs/receive','POST',()=>click('[data-action="handoff-receive"]'));
        if(value.sha256!==item.sha256||value.bytes!==item.bytes||value.revision!==revision||value.sourceId!==original.sourceId||value.mode!==mode||
          value.rowCount!==original.rowCount||value.stationCount!==original.stationCount||value.ready!==selected.expectedReady)
          throw new Error('Provider receiving changed the original bundle identity, review or complete row/station coverage.');
        await page.locator('#handoff-received-detail[data-sha="'+item.sha256+'"]').waitFor({state:'visible',timeout:120000});
        const received=await handoffRead('received/'+item.sha256,ready.receiver.url);
        if(received.profile.sourceId!==original.sourceId||received.receipt.revision!==revision||received.review.ready!==selected.expectedReady)
          throw new Error('The customer did not reopen the original reviewed provider profile.');
        const copy=await receiveDownload('handoff-download-received','handoff-received-'+i+'-'+selected.label+'.zip');
        if(copy.sha256!==item.sha256||copy.bytes!==item.bytes)throw new Error('The customer redownload differs from the exact received original.');
        const retained={sourceId:original.sourceId,revision,mode,sha256:value.sha256,bytes:value.bytes,
          rowCount:value.rowCount,stationCount:value.stationCount,ready:value.ready,redownload:copy};
        const old=result.providerReceiving.find(x=>x.sha256===value.sha256);
        if(old&&canonical(old)!==canonical(retained))throw new Error('A retained provider receiving result changed.');
        if(!old)result.providerReceiving.push(retained);
      });
    }
  }
  if(result.providerReceiving.length)await phase('provider_customer_reopen',async()=>{
    await open(ready.receiver.url);await nav('handoffs');
    if(await page.locator('[data-action="handoff-tab"][data-tab="review"]').count())await handoffTab('review');
    const expected=result.providerReceiving[result.providerReceiving.length-1];
    await click('[data-action="handoff-open-received"][data-id="'+expected.sha256+'"]');
    await page.locator('#handoff-received-detail[data-sha="'+expected.sha256+'"]').waitFor({state:'visible',timeout:120000});
    const state=await handoffRead('',ready.receiver.url);
    if(result.providerReceiving.some(x=>!state.received.some(r=>r.sha256===x.sha256&&r.revision===x.revision)))
      throw new Error('A received provider bundle disappeared after browser reopening.');
    result.providerReceiverReopened=true;
  });
}

(async()=>{
  try{
    fs.mkdirSync(out,{recursive:true,mode:0o700});
    const options={headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disk-cache-size=1048576','--media-cache-size=1048576','--disable-gpu-shader-disk-cache']};
    const executable=process.env.ERDDAP_CHROMIUM_EXECUTABLE||process.env.SDMX_CHROMIUM_EXECUTABLE||process.env.DICOM_CHROMIUM_EXECUTABLE;
    if(executable)options.executablePath=executable;
    browser=await chromium.launch(options);
    context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,...(saved.storageState?{storageState:saved.storageState}:{})});
    page=await context.newPage();attach(page);await open(ready.original.url);
    const initial=await currentState(ready.original.url);
    if(initial.workspace.id!==ready.workspaceId)throw new Error('Original browser opened another workspace.');
    result.inputManifestSha256=ready.inputManifestSha256;
    result.handoffManifestSha256=ready.handoffManifestSha256;result.playwrightVersion=playwrightVersion;
    result.currentSourceRevision=crypto.createHash('sha256').update(JSON.stringify(ready.sourceFiles)).digest('hex');
    result.sourceRevisions=result.sourceRevisions||{};result.sourceRevisions[result.currentSourceRevision]=ready.sourceFiles;
    result.phaseSources=result.phaseSources||{};
    await phase('original_workspace',async()=>{
      result.initial={sources:initial.sources.length,builds:initial.builds.length,comparisons:initial.comparisons.length};
      result.datasetRoutes=ready.inputs.map(x=>({file:x.name,sha256:x.sha256}));
    });
    for(let i=0;i<ready.inputs.length;i++){
      const input=ready.inputs[i];
      if(digest(input.path)!==input.sha256)throw new Error('The actual source ZIP changed: '+input.name);
      await phase('source_'+i,async()=>{
        await nav('sources');await page.locator('#source-file').setInputFiles(input.path);await page.locator('#source-label').fill(input.label);
        const value=await response('/api/sources','POST',()=>click('[data-action="import-source"]'));
        if(value.id!==input.sha256)throw new Error('Imported source identity differs from the complete original ZIP.');
        await selectedSource(value.id);
        const rows=await context.request.get(new URL('/api/sources/'+value.id+'/rows?limit=1',ready.original.url).href,
          {headers:{Authorization:'Bearer '+new URL(ready.original.url).hash.slice(1)}});
        if(!rows.ok())throw new Error('Original source row inspection failed.');
        const first=await rows.json();
        result.sources[i]={id:value.id,label:value.label,datasetId:value.inventory.datasetId,protocol:value.inventory.protocol,
          rowCount:value.inventory.rowCount,columns:first.columns,firstRow:first.rows[0]||null,csvComparison:value.inventory.csvComparison};
      });
      await phase('mapping_build_'+i,async()=>{
        await nav('sources');await click('[data-action="select-source"][data-id="'+result.sources[i].id+'"]');
        await selectedSource(result.sources[i].id);await proposeMapping(result.sources[i].id);
        const name=result.sources[i].datasetId+' — retained original selection';
        await page.locator('#mapping-name').fill(name);
        const providerProfile=(ready.handoffProfiles||[]).find(x=>x.sourceId===result.sources[i].id);
        if(providerProfile)await page.locator('#mapping-csv').selectOption(providerProfile.profile.dataEdition);
        await click('[data-action="review-mapping"]');
        const build=await response('/api/builds','POST',()=>click('[data-action="confirm-review"]'));
        if(build.source!==result.sources[i].id||build.rowCount!==result.sources[i].rowCount)throw new Error('Native build did not retain the complete selected source.');
        result.builds[i]={id:build.id,source:build.source,plan:build.plan,rowCount:build.rowCount,snapshot:build.native.snapshot,
          keys:build.keys,files:build.files,name:build.native.name};
        result.currentBuild=build.id;checkpoint();
        await page.locator('#native-result').waitFor({state:'visible',timeout:120000});
      });
      await phase('native_query_'+i,async()=>{
        await nav('editions');await click('[data-action="select-build"][data-id="'+result.builds[i].id+'"]');
        await selectedBuild(result.builds[i].id);
        result.currentBuild=result.builds[i].id;
        const first=await queryFirst(1);
        if(first.response.status!==200)throw new Error('Original native query returned '+first.response.status);
        const body=first.response.body;
        result.builds[i].firstQuery={fields:body.fields,rows:body.rows,page:body.page};
        if(body.page&&body.page.nextCursor){
          const next=await response('/api/builds/'+result.currentBuild+'/query','GET',()=>click('[data-action="native-next"]'));
          if(next.response.status!==200)throw new Error('Original cursor query failed.');
          result.builds[i].secondPage={fields:next.response.body.fields,rows:next.response.body.rows,page:next.response.body.page};
          await click('[data-action="native-previous"]');
        }
      });
      await phase('exports_'+i,async()=>{
        await nav('editions');await click('[data-action="select-build"][data-id="'+result.builds[i].id+'"]');
        await selectedBuild(result.builds[i].id);
        result.builds[i].projectExport=await receiveDownload('export-packet','project-'+i+'.erddap.zip');
        result.builds[i].datasetExport=await receiveDownload('export-dataset','dataset-'+i+'.zip');
      });
    }
    await phase('retained_mapping_draft',async()=>{
      await nav('sources');await click('[data-action="select-source"][data-id="'+result.sources[0].id+'"]');
      await selectedSource(result.sources[0].id);
      if(!await page.locator('#mapping-name').count())await proposeMapping(result.sources[0].id);
      await page.locator('#mapping-name').waitFor({state:'visible'});
      const name=await page.locator('#mapping-name').inputValue(),draft=name+' · unsaved operator draft';
      await page.locator('#mapping-name').fill(draft);await click('[data-action="refresh"]');
      await page.waitForFunction(expected=>document.querySelector('#mapping-name')&&document.querySelector('#mapping-name').value===expected,draft,{timeout:120000});
      result.mappingDraftPreserved=true;
    });
    await phase('edition_comparison',async()=>{
      const first=result.builds[0],other=result.builds.find((b,i)=>i>0&&b.plan===first.plan)||first;
      await nav('compare');await page.locator('#compare-before').selectOption(first.id);await page.locator('#compare-after').selectOption(other.id);
      const value=await response('/api/comparisons','POST',()=>click('[data-action="compare"]'));
      if(value.before!==first.id||value.after!==other.id)throw new Error('Compared another edition selection.');
      if(first.id===other.id&&(value.counts.unchanged!==first.rowCount||value.counts.added||value.counts.removed||value.counts.changed))
        throw new Error('The exact original edition differs from itself.');
      result.comparison={...value,sameOriginalEdition:first.id===other.id};
    });
    await phase('desktop_and_phone',async()=>{
      await nav('editions');await click('[data-action="select-build"][data-id="'+result.builds[0].id+'"]');
      await selectedBuild(result.builds[0].id);
      if(ready.screenshots)await page.screenshot({path:path.join(out,'operator-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      const overflow=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
      if(overflow.width>overflow.viewport+1)throw new Error('The operator layout overflows the phone viewport.');
      if(ready.screenshots)await page.screenshot({path:path.join(out,'operator-phone.png'),fullPage:true});
      result.viewports={desktop:1440,phone:390,horizontalOverflow:false};await page.setViewportSize({width:1440,height:960});
    });
    await providerBrowser();
    await preserveContext();await open(ready.receiver.url);
    const receiver=await currentState(ready.receiver.url);
    if(receiver.workspace.id!==ready.receiverWorkspaceId)throw new Error('Customer browser opened another workspace.');
    for(let i=0;i<result.builds.length;i++){
      await phase('customer_receive_'+i,async()=>{
        await nav('receive');const packet=path.join(out,result.builds[i].projectExport.file);
        if(digest(packet)!==result.builds[i].projectExport.sha256)throw new Error('Original project export changed before receiving.');
        await page.locator('#packet-file').setInputFiles(packet);
        const value=await response('/api/packets','POST',()=>click('[data-action="import-packet"]'));
        if(!value.reconstructed||value.build.native.snapshot!==result.builds[i].snapshot||
          value.build.source!==result.builds[i].source||value.build.plan!==result.builds[i].plan||
          value.build.rowCount!==result.builds[i].rowCount)throw new Error('Customer reconstruction differs from the original source/edition.');
        await page.locator('#receiving-result').waitFor({state:'visible',timeout:120000});
        await click('[data-action="received-edition"]');await selectedBuild(value.build.id);
        result.currentBuild=value.build.id;const q=await queryFirst(1);
        if(q.response.status!==200||JSON.stringify(q.response.body.rows)!==JSON.stringify(result.builds[i].firstQuery.rows))
          throw new Error('Customer native query differs from the original retained exact values.');
        result.receiving[i]={build:value.build.id,source:value.source,plan:value.plan,rowCount:value.build.rowCount,
          snapshot:value.build.native.snapshot,firstQuery:{fields:q.response.body.fields,rows:q.response.body.rows}};
      });
    }
    await providerReceiveBrowser();
    await phase('browser_reopen',async()=>{
      await open(ready.receiver.url);
      const state=await currentState(ready.receiver.url);
      if(result.receiving.some(x=>!state.builds.some(b=>b.id===x.build&&b.native.snapshot===x.snapshot)))throw new Error('Customer editions did not reopen.');
      result.receiverState={sources:state.sources.length,plans:state.plans.length,builds:state.builds.length};
    });
    if(result.errors.length)throw new Error('The original browser recorded '+result.errors.length+' page errors.');
    delete result.currentBuild;delete result.currentPhase;result.status='ERDDAP_BROWSER_COMPLETE';result.completedAt=new Date().toISOString();
    await preserveContext();checkpoint();process.stdout.write(JSON.stringify({status:result.status,result:resultPath})+'\n');
  }catch(error){
    result.status='FAILED';result.currentPhase=currentPhase;result.failure={phase:currentPhase,message:String(error.message).slice(0,3000),requestErrors};
    if(page){try{saved.failure={url:page.url(),title:await page.title(),body:(await page.locator('body').innerText()).slice(0,12000)};await preserveContext();}catch(_){}}
    checkpoint();process.stderr.write(JSON.stringify({phase:currentPhase,error:result.failure.message,result:resultPath})+'\n');process.exitCode=1;
  }finally{
    if(context)await context.close().catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
  }
})();
