/** Receive one original PortfolioWorkspace through its actual target desk. */
import {readFile, writeFile, mkdir, open, rename, stat} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ?
  Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const pause = ms => new Promise(done => setTimeout(done, ms));
const exists = async path => {try {await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
async function save(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  await mkdir(dirname(path), {recursive:true, mode:0o700});
  const temporary = path + '.' + process.pid + '.tmp';
  const file = await open(temporary, 'w', 0o600);
  try {await file.writeFile(bytes);await file.sync();} finally {await file.close();}
  await rename(temporary, path);
  const parent = await open(dirname(path), 'r');try{await parent.sync();}finally{await parent.close();}
}
async function savedJSON(path, fallback) {
  try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}
}
function requireValue(condition, message) {if(!condition)throw new Error(message);}
async function waitFor(check, description, milliseconds=300000) {
  const started=Date.now();
  for (;;) {const value=await check();if(value)return value;if(Date.now()-started>milliseconds)throw new Error(description);await pause(250);}
}

export async function receiveDesk(entry) {
  const out=resolve(entry.output);
  await mkdir(out,{recursive:true,mode:0o700});
  const progressPath=join(out,'browser-progress.json'),storagePath=join(out,'browser-storage.json');
  const progress=await savedJSON(progressPath,{schema:'portfolio.operator-native-browser.v1',
    operation_id:entry.operation_id,phase:entry.phase||'original',steps:{},created_at:new Date().toISOString()});
  requireValue(progress.operation_id===entry.operation_id && progress.phase===(entry.phase||'original'),'Reopen the same original receiving operation and phase.');
  const persist=()=>save(progressPath,progress);
  const resultPath=join(out,'browser-result.json');
  if(await exists(resultPath)){
    const prior=await savedJSON(resultPath);
    for(const artifact of prior.artifacts||[]){
      const bytes=await readFile(artifact.path);
      requireValue(bytes.length===artifact.bytes && sha(bytes)===artifact.sha256,'A completed original receiving artifact changed.');
    }
    return prior;
  }
  const url=new URL(entry.url),token=new URLSearchParams(url.hash.slice(1)).get('token');
  requireValue(token && url.protocol==='http:' && ['127.0.0.1','[::1]','localhost'].includes(url.hostname),
    'Use the actual private local target-desk entry.');
  const origin=url.origin;
  const api=async path=>{
    const response=await fetch(origin+path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
    const body=await response.text();let value;try{value=JSON.parse(body);}catch{throw new Error('Incomplete original local response at '+path);}
    if(!response.ok)throw Object.assign(new Error(value.error?.message||'Original local read failed'),{status:response.status,code:value.error?.code});
    return value;
  };
  const {chromium}=await import(pathToFileURL(resolve(entry.playwright)).href);
  await mkdir(entry.browser_directory,{recursive:true,mode:0o700});
  const browser=await chromium.launch({executablePath:resolve(entry.chromium),headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage'],env:{...process.env,TMPDIR:entry.browser_directory}});
  let context,page,active=null;
  const errors=[];
  const remember=async()=>{if(context)await save(storagePath,await context.storageState());};
  const screenshot=async(name,width)=>{
    const path=join(out,name);
    if(await exists(path)){
      const bytes=await readFile(path),prior=progress.screenshots?.[name];
      requireValue(prior && ['CAPTURING','COMPLETE'].includes(prior.state),'Keep the original screenshot capture intent.');
      if(prior.state==='CAPTURING'){
        requireValue(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'The retained screenshot is incomplete.');
        progress.screenshots[name]={...prior,state:'COMPLETE',sha256:sha(bytes),bytes:bytes.length,recovered_after_carrier_interruption:true};await persist();
      }else requireValue(prior.sha256===sha(bytes) && prior.bytes===bytes.length,'Keep the exact completed original screenshot.');
      return {path,filename:name,...progress.screenshots[name]};
    }
    progress.screenshots??={};progress.screenshots[name]={state:'CAPTURING',width,started_at:new Date().toISOString()};await persist();
    await page.setViewportSize({width,height:width<600?844:1000});
    const bytes=await page.screenshot({fullPage:true});
    await save(path,bytes);
    const item={state:'COMPLETE',width,sha256:sha(bytes),bytes:bytes.length};
    progress.screenshots??={};progress.screenshots[name]=item;await persist();
    return {path,filename:name,...item};
  };
  const findHistory=async id=>{
    await page.locator('[data-tab="history"]').click();
    await page.locator('#refresh').click();
    for(let n=0;n<10000;n++){
      const row=page.locator('#history-table .finding').filter({has:page.locator('p').filter({hasText:new RegExp('^'+id+'$')})});
      if(await row.count())return row;
      const more=page.getByRole('button',{name:'More original requests',exact:true});
      if(!await more.count()||!await more.isVisible())throw new Error('Original saved request is absent from its complete history: '+id);
      const before=await page.locator('#history-table .finding').count();
      await more.click();
      await waitFor(async()=>await page.locator('#history-table .finding').count()>before || !(await more.count()),'Original request pagination did not advance.');
    }
    throw new Error('Original request history did not terminate.');
  };
  const openResult=async request=>{
    const row=await findHistory(request.id);
    await row.locator('button').first().click();
    await page.getByRole('button',{name:'Open saved result',exact:true}).click();
    await waitFor(async()=>{
      if((await page.locator('#active-label').innerText()).startsWith('Saved request'))return false;
      if(request.kind==='intake')return await page.locator('#source-edition').inputValue()===request.result.id;
      if(request.kind==='source_apply')return await page.locator('#source-edition').inputValue()===request.result.edition_id;
      if(request.kind==='source_review')return (await page.locator('#source-review').innerText()).includes(request.result.id);
      if(request.kind==='handover')return await page.locator('#handover-artifacts button[title="'+request.result.html.sha256+'"]').count()>0;
      if(request.kind==='archive')return await page.locator('#handover-artifacts button[title="'+request.result.archive.sha256+'"]').count()>0;
      if(request.kind==='archive_inspect')return (await page.locator('#archive-receive-summary').innerText()).includes(request.result.manifest_sha256);
      if(request.kind.startsWith('archive_'))return await page.locator('#archive-cohort').inputValue()===request.result.cohort_id;
      if(request.result?.id)return await page.locator('#deployment-select').inputValue()===request.result.id;
      return true;
    },'The original browser has not opened this exact saved result.');
    const tab=request.kind.startsWith('archive_')?'archive':['intake','source_review','source_apply','mspdi_export'].includes(request.kind)?'source':
      ['receive_target_file','capture_target','accept','handover','archive'].includes(request.kind)?'receiving':'migration';
    await page.locator('[data-tab="'+tab+'"]').click();
  };
  const action=async(name,kind,trigger,{discardReply=false}={})=>{
    active={name,kind,discardReply};
    progress.steps[name]??={kind};
    let item=progress.steps[name];
    requireValue(item.kind===kind,'The original receiving stage has another action kind.');
    let request=null;
    if(item.request){
      try{request=await api('/api/requests/'+item.request.request_id);}catch(error){if(error.status!==404)throw error;}
      if(request){
        requireValue(request.kind===kind && canonical(request.arguments)===canonical(item.request.arguments),'The original request input changed.');
        if(request.state==='FAILED'&&!entry.resume_failed)throw new Error('Original '+name+' failed: '+JSON.stringify(request.error)+'. Resume that saved request after the source correction.');
        if(!['COMPLETE','FAILED'].includes(request.state)||request.state==='FAILED'){
          const row=await findHistory(request.id);await row.locator('button').first().click();
          await page.getByRole('button',{name:request.state==='FAILED'?'Retry this same saved request':'Resume this same saved request',exact:true}).click();
        }
      }else{
        const pending=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('portfolio-desk:')&&k.endsWith(':pending'))
          .map(k=>JSON.parse(localStorage.getItem(k))).find(x=>x));
        requireValue(pending?.request_id===item.request.request_id,'The original unsent request is retained in browser-storage.json; reopen that exact browser state.');
        await page.locator('#recover-request').click();
      }
    }else{
      await trigger();
      await waitFor(()=>progress.steps[name]?.request,'The original UI did not retain its action before sending.');
    }
    item=progress.steps[name];
    if(discardReply && !item.complete){
      await waitFor(()=>item.discarded_response || item.carrier_recovery || item.dispatch_observed,'The retained local intake response was not observed.');
      if(item.discarded_response){await remember();await page.reload();await page.locator('#workspace').waitFor({state:'visible'});}
    }
    request=await waitFor(async()=>{
      let current;
      try{current=await api('/api/requests/'+item.request.request_id);}catch(error){if(error.status===404)return null;throw error;}
      if(current.state==='FAILED')throw new Error('Original '+name+' failed: '+JSON.stringify(current.error));
      return current.state==='COMPLETE'?current:null;
    },'The original '+name+' remains pending; its request ID is retained.');
    if(discardReply && !item.discarded_response)item.carrier_recovery='Original request completed before the carrier restored its local discard receipt.';
    item.complete={request_id:request.id,input_sha256:request.input_sha256,result_sha256:request.result_sha256,
      observed_at:new Date().toISOString()};
    await persist();
    await waitFor(async()=>{
      const text=await page.locator('#active-label').innerText();
      return !text.startsWith('Saved request');
    },'The actual browser has not consumed the original completed result.');
    await openResult(request);await remember();active=null;
    return request;
  };
  const downloadArtifact=async(item,container,filename=item.filename)=>{
    const path=join(out,filename);
    if(await exists(path)){
      const bytes=await readFile(path);
      requireValue(sha(bytes)===item.sha256 && bytes.length===item.bytes,'The saved original download changed.');
      return {path,filename,sha256:item.sha256,bytes:item.bytes};
    }
    requireValue(/^[a-f0-9]{64}$/.test(item.sha256),'The selected original artifact identity is incomplete.');
    const button=page.locator(container).locator('button[title="'+item.sha256+'"]').filter({hasText:filename+' · '});
    requireValue(await button.count()===1,'Select exactly one original saved artifact: '+filename);
    const downloadPromise=page.waitForEvent('download');
    await button.click();
    const download=await downloadPromise;
    requireValue(!await download.failure(),'The original artifact download failed.');
    const temporary=path+'.'+process.pid+'.download';
    await download.saveAs(temporary);
    const bytes=await readFile(temporary);
    requireValue(sha(bytes)===item.sha256 && bytes.length===item.bytes,'The downloaded bytes differ from the original artifact.');
    const written=await open(temporary,'r');try{await written.sync();}finally{await written.close();}
    await rename(temporary,path);
    return {path,filename,sha256:item.sha256,bytes:item.bytes};
  };
  try{
    const identity=await api('/api/hello');
    if(progress.workspace_id)requireValue(progress.workspace_id===identity.workspace_id,'Reopen the exact original workspace before restoring its local browser state.');
    let retainedStorage=await savedJSON(storagePath,null);
    if(retainedStorage&&progress.origin&&progress.origin!==origin){
      const ownPrefix='portfolio-desk:'+identity.workspace_id+':';
      retainedStorage={cookies:[],origins:retainedStorage.origins.filter(x=>x.origin===progress.origin).map(x=>({
        origin,localStorage:x.localStorage.filter(item=>item.name.startsWith(ownPrefix))}))};
    }
    progress.origin=origin;progress.workspace_id=identity.workspace_id;await persist();
    context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000},
      ...(retainedStorage?{storageState:retainedStorage}:{})});
    page=await context.newPage();
    page.on('pageerror',error=>errors.push(String(error)));
    await page.route('**/api/actions',async route=>{
      try{
        requireValue(active,'A browser mutation appeared outside the retained receiving stage.');
        const request=route.request().postDataJSON(),name=active.name;
        requireValue(request.kind===active.kind,'The browser selected another action kind.');
        const item=progress.steps[name];
        if(item.request)requireValue(canonical(item.request)===canonical(request),'The original receiving stage attempted another request.');
        else{item.request=request;item.retained_at=new Date().toISOString();}
        await remember();await persist();
        if(active.discardReply&&!item.discarded_response&&!item.dispatch_observed){
          item.dispatch_observed=new Date().toISOString();await persist();
          const response=await route.fetch(),bytes=await response.body();
          const responseFile=join(out,'original-intake-acknowledgement.json');
          await save(responseFile,bytes);
          item.discarded_response={status:response.status(),bytes:bytes.length,sha256:sha(bytes),path:responseFile};
          await persist();await route.abort('failed');
        }else await route.continue();
      }catch(error){
        errors.push(String(error));try{await route.abort('failed');}catch{}
      }
    });
    await page.goto(entry.url);
    await page.locator('#workspace').waitFor({state:'visible'});
    const hello=await api('/api/hello');
    if(progress.workspace_id)requireValue(progress.workspace_id===hello.workspace_id,'The receiving browser opened another workspace.');
    progress.workspace_id=hello.workspace_id;await persist();
    if(['archive','archive-restored','archive-reopened'].includes(entry.phase)){
      const {receiveArchiveDesk}=await import(new URL('../../archive/native/browser.mjs',import.meta.url));
      const result=await receiveArchiveDesk({entry,out,progress,api,page,action,downloadArtifact,screenshot,
        waitFor,requireValue,remember,persist,errors,hello,save});
      requireValue(errors.length===0,'Unexpected browser error: '+errors.join('\n'));
      await remember();await save(resultPath,result);return result;
    }
    if(entry.phase==='restored'){
      const accepted=entry.original;
      requireValue(hello.workspace_id===accepted.workspace_id,'The portable workspace changed its original identity.');
      const deployment=await api('/api/deployments/'+accepted.deployment_id);
      requireValue(deployment.state==='ACCEPTED' && deployment.source_edition_id===accepted.source_edition_id &&
        deployment.capture_edition_id===accepted.capture_edition_id && deployment.acceptance_sha256===accepted.acceptance_sha256,
        'Cold receiving changed an original accepted project identity.');
      const source=await api('/api/editions/'+accepted.source_edition_id);
      requireValue(source.id===accepted.source_edition_id,'The original source did not reopen from the archive.');
      await page.locator('#source-edition').selectOption(accepted.source_edition_id);
      await page.locator('[data-tab="migration"]').click();
      await page.locator('#deployment-select').selectOption(accepted.deployment_id);
      await waitFor(async()=>(await page.locator('#deployment-summary').innerText()).includes('ACCEPTED'),'The restored selected migration did not reopen.');
      const handover=await api('/api/requests/'+accepted.handover_request_id);
      requireValue(handover.state==='COMPLETE','The original handover request was not preserved.');
      await openResult(handover);await page.locator('[data-tab="receiving"]').click();
      const artifacts=[];
      artifacts.push(await downloadArtifact(handover.result.html,'#handover-artifacts'));
      artifacts.push(await downloadArtifact(handover.result.json,'#handover-artifacts'));
      for(const item of artifacts){
        const prior=accepted.artifacts.find(x=>x.filename===item.filename);
        requireValue(prior?.sha256===item.sha256,'Cold receiving changed an original handover artifact.');
      }
      artifacts.push(await screenshot('restored-desktop.png',1440));
      artifacts.push(await screenshot('restored-mobile.png',390));
      requireValue(errors.length===0,'Unexpected browser error: '+errors.join('\n'));
      const result={schema:'portfolio.operator-native-browser-result.v1',operation_id:entry.operation_id,phase:'restored',
        workspace_id:hello.workspace_id,deployment_id:deployment.id,source_edition_id:source.id,
        capture_edition_id:deployment.capture_edition_id,acceptance_sha256:deployment.acceptance_sha256,
        artifacts,errors,completed_at:new Date().toISOString()};
      await remember();await save(resultPath,result);return result;
    }

    const sourceBytes=await readFile(entry.source);
    requireValue(sha(sourceBytes)===entry.source_sha256,'The selected original MPXJ fixture changed.');
    const intake=await action('01-intake','intake',async()=>{
      await page.locator('[data-tab="source"]').click();
      await page.locator('#source-file').setInputFiles(entry.source);
      await page.locator('#source-label').fill(entry.source_label||'Original MPXJ receiving fixture');
      await page.locator('#intake-form button').last().click();
    },{discardReply:true});
    const originalId=intake.result.id;
    await page.locator('[data-tab="source"]').click();
    await page.locator('#source-edition').selectOption(originalId);
    let selected=progress.selected_task;
    if(!selected){
      let offset=0;
      for(;;){
        const rows=await api('/api/editions/'+originalId+'?family=tasks&offset='+offset+'&limit=50');
        selected=rows.items.find(row=>row.fields?.NAME?.type==='string' && typeof row.fields.NAME.value==='string');
        if(selected){progress.selected_task={...selected,page_offset:offset};await persist();selected=progress.selected_task;break;}
        if(rows.next_offset===null)throw new Error('The actual fixture has no editable native task NAME.');
        offset=rows.next_offset;
      }
    }
    const after={...selected.fields.NAME,value:selected.fields.NAME.value+' · receiving revision'};
    if(!progress.steps['02-source-review']?.request){
      await page.locator('#source-family').selectOption('tasks');
      await waitFor(async()=>(await page.locator('#source-range').innerText()).startsWith('Rows 1–'),'The original task page is still changing.');
      for(let offset=0;offset<selected.page_offset;offset+=50){await page.locator('#source-next').click();await waitFor(async()=>(await page.locator('#source-range').innerText()).startsWith('Rows '+(offset+51)+'–'),'The actual task page did not advance.');}
      const row=page.locator('#source-table tbody tr').filter({has:page.getByRole('cell',{name:selected.key,exact:true})});
      await row.getByRole('button',{name:'Inspect fields',exact:true}).click();
      await page.locator('#correction-field').selectOption('NAME');
      const before=JSON.parse(await page.locator('#correction-before').innerText());
      requireValue(canonical(before)===canonical(selected.fields.NAME),'The actual source correction preimage changed.');
      await page.locator('#correction-after').fill(JSON.stringify(after));
      await page.locator('#add-correction').click();
      if(!await page.locator('#source-decisions').isVisible())await page.getByText('Source review decisions',{exact:true}).click();
      await page.locator('#source-decisions').fill(JSON.stringify(entry.review_decisions||{}));
    }
    const reviewed=await action('02-source-review','source_review',()=>page.locator('#review-source').click());
    if(!reviewed.result.ready){await save(join(out,'source-review-findings.json'),reviewed.result);throw new Error('Resolve the actual original source-review findings in source-review-findings.json.');}
    const applied=await action('03-source-apply','source_apply',()=>page.locator('#apply-source').click());
    const editionId=applied.result.edition_id;
    const rows=await api('/api/editions/'+editionId+'?family=tasks&offset='+selected.page_offset+'&limit=50');
    requireValue(canonical(rows.items.find(x=>x.key===selected.key)?.fields.NAME)===canonical(after),
      'The original native NAME correction did not appear in its following source edition.');
    await page.locator('[data-tab="target"]').click();
    await page.locator('#target-profile').selectOption('mspdi');
    const prepared=await action('04-target-prepare','prepare',()=>page.locator('#prepare-target').click());
    const deploymentId=prepared.result.id;
    await page.locator('[data-tab="migration"]').click();
    await page.locator('#deployment-select').selectOption(deploymentId);
    await page.locator('#reviewer').fill(entry.reviewer||'Original source receiving operator');
    await page.locator('#review-note').fill('Review the original source edition and complete native MSPDI file handover for this receiving operation.');
    const reviewedTarget=await action('05-target-review','review',()=>page.locator('#review-target').click());
    const exported=await action('06-target-export','continue',()=>page.locator('#continue-target').click());
    requireValue(exported.result.state==='EXPORTED','The original native writer did not retain the target file.');
    const exportResult=await api('/api/objects/'+exported.result.export_result_sha256);
    await page.locator('[data-tab="receiving"]').click();
    const xml=await downloadArtifact(exportResult.download,'#export-artifacts');
    if(!progress.steps['07-receive-file']?.request){
      await page.locator('#target-file').setInputFiles(xml.path);
      await page.locator('#target-file-label').fill('Actual MPXJ Project XML round-trip receiving');
    }
    const received=await action('07-receive-file','receive_target_file',()=>page.locator('#receive-file-form button').click());
    const comparison=await api('/api/objects/'+received.result.comparison_sha256);
    requireValue(comparison.left_id===exported.result.intended_edition_id &&
      comparison.right_id===received.result.capture_edition_id,'The target comparison names another intended or received edition.');
    await page.locator('#accept-reviewer').fill(entry.reviewer||'Original source receiving operator');
    await page.locator('#accept-note').fill('Accept this actual MPXJ Project XML round trip for the retained receiving fixture. Keep every observed comparison entry with the original source and native exports.');
    await page.locator('#accept-exceptions').fill((comparison.changes||[]).length ?
      'Retain all '+comparison.changes.length+' observed native round-trip differences in the complete comparison and handover.' : '');
    const accepted=await action('08-accept','accept',()=>page.locator('#accept-target').click());
    const handover=await action('09-handover','handover',()=>page.locator('#build-handover').click());
    await page.locator('[data-tab="receiving"]').click();
    const artifacts=[xml];
    artifacts.push(await downloadArtifact(handover.result.html,'#handover-artifacts'));
    artifacts.push(await downloadArtifact(handover.result.json,'#handover-artifacts'));
    artifacts.push(await screenshot('accepted-desktop.png',1440));
    artifacts.push(await screenshot('accepted-mobile.png',390));
    await page.setViewportSize({width:1440,height:1000});
    const archived=await action('10-archive','archive',()=>page.locator('#export-workspace').click());
    await page.locator('[data-tab="receiving"]').click();
    const archive=await downloadArtifact({...archived.result.archive,filename:archived.result.filename},'#handover-artifacts');
    artifacts.push(archive);
    const completeRequests=Object.values(progress.steps).map(x=>x.complete?.request_id).filter(Boolean);
    requireValue(new Set(completeRequests).size===10,'The original receiving stages reused or duplicated an action identity.');
    const originalIntake=await api('/api/requests/'+progress.steps['01-intake'].request.request_id);
    requireValue(originalIntake.result.id===originalId,'The lost-reply continuation changed the original source edition.');
    requireValue(errors.length===0,'Unexpected browser error: '+errors.join('\n'));
    const result={schema:'portfolio.operator-native-browser-result.v1',operation_id:entry.operation_id,phase:'original',
      workspace_id:hello.workspace_id,source_fixture_sha256:entry.source_sha256,original_source_edition_id:originalId,
      source_edition_id:editionId,intended_edition_id:exported.result.intended_edition_id,
      deployment_id:deploymentId,capture_edition_id:received.result.capture_edition_id,
      acceptance_sha256:accepted.result.acceptance_sha256,comparison_sha256:received.result.comparison_sha256,
      handover_request_id:handover.id,archive_request_id:archived.id,archive,
      correction:{family:'tasks',key:selected.key,field:'NAME',before:selected.fields.NAME,after},
      original_request_ids:completeRequests,discarded_reply:progress.steps['01-intake'].discarded_response||null,
      carrier_recovery:progress.steps['01-intake'].carrier_recovery||null,
      evidence_kind:'Original MPXJ reader/writer Project XML round trip through the actual target desk',
      artifacts,errors,completed_at:new Date().toISOString()};
    await remember();await save(resultPath,result);return result;
  }finally{
    try{if(context)await remember();}finally{await browser.close();}
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const entry=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
  const result=await receiveDesk(entry);
  process.stdout.write(JSON.stringify({state:'COMPLETE',operation_id:result.operation_id,phase:result.phase,
    result_file:join(resolve(entry.output),'browser-result.json'),artifacts:result.artifacts.map(({path,filename,sha256,bytes})=>({path,filename,sha256,bytes}))})+'\n');
}
