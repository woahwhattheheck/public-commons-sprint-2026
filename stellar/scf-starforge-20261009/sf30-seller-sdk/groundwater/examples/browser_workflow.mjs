#!/usr/bin/env node
/** Same-data browser continuation; each original UI request is retained before dispatch. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const input=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const output=path.resolve(input.output_directory),journal=path.resolve(input.browser_journal);
await fs.mkdir(journal,{recursive:true});await fs.mkdir(output,{recursive:true});
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const require=(condition,message)=>{if(!condition)throw new Error(message);};
const exists=async p=>{try{await fs.stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const readJSON=async p=>JSON.parse(await fs.readFile(p,'utf8'));
async function writeJSON(file,value){
 const raw=Buffer.from(stable(value)+'\n');
 if(await exists(file)){require((await fs.readFile(file)).equals(raw),'Original publication differs: '+file);return;}
 const temp=file+'.'+crypto.randomUUID()+'.tmp',handle=await fs.open(temp,'wx',0o600);
 try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
 try{await fs.link(temp,file);}catch(e){if(e.code!=='EEXIST')throw e;require((await fs.readFile(file)).equals(raw),'Original publication differs: '+file);}finally{await fs.unlink(temp);}
 const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
}
async function exact(file,expected){
 const raw=await fs.readFile(file);require(raw.length===expected.bytes&&sha(raw)===expected.sha256,'Original artifact is unavailable or changed: '+file);
 return raw;
}
function normalized(original){
 const request=structuredClone(original);
 if(request.payload?.content_base64!==undefined){
  const raw=Buffer.from(request.payload.content_base64,'base64');
  delete request.payload.content_base64;
  request.payload.original_upload={bytes:raw.length,sha256:sha(raw)};
 }
 return request;
}
const origin=new URL(input.operator_url).origin;
require(new URL(input.operator_url).hostname==='127.0.0.1','Use the selected original loopback operator.');
async function api(relative,options={}){
 const response=await fetch(origin+'/api'+relative,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
 const value=await response.json();
 if(!response.ok){const error=new Error(value.error?.message||'Original read failed');error.code=value.error?.code;error.status=response.status;error.detail=value;throw error;}
 return value;
}
const state=await api('/state?project_id='+encodeURIComponent(input.project_id));
require(state.workspace.id===input.workspace_id,'The operator opened a different original workspace.');
const mode=input.mode||'operate',resultFile=path.join(output,'browser-'+mode+'-result.json');
if(await exists(resultFile)){
 const retained=await readJSON(resultFile);
 require(retained.operation_id===input.operation_id&&retained.workspace_id===input.workspace_id,'The saved browser outcome belongs to another original input.');
 for(const item of retained.screenshots||[])await exact(path.join(output,item.path),item);
 for(const item of retained.requests||[]){
  const operation=await api('/operations/'+encodeURIComponent(item.operation_id));
  require(operation.request_sha256===item.request_sha256,'A committed original browser request changed.');
 }
 if(retained.scenario_run_id)await api('/runs/'+retained.scenario_run_id);
 if(retained.report_id)await api('/reports/'+retained.report_id);
 process.stdout.write(JSON.stringify({state:'complete',replayed:true,result:resultFile})+'\n');
 process.exitCode=0;
}else{
 await fs.mkdir(path.join(journal,'browser-tmp'),{recursive:true});
 const module=await import(pathToFileURL(input.playwright_module).href);
 const browser=await module.chromium.launch({executablePath:input.browser_executable,headless:true,args:['--disable-dev-shm-usage'],env:{...process.env,TMPDIR:path.join(journal,'browser-tmp')}});
 let context,page,activePhase=null,routeError=null,stopping=false;
 const screenshots=[],requests=[];
 const halt=()=>{stopping=true;};
 process.on('SIGTERM',halt);process.on('SIGINT',halt);
 const check=()=>{if(stopping)throw new Error('The original browser continuation was stopped; retain its exact phase requests.');};
 try{
  await fs.mkdir(path.join(journal,'browser-tmp'),{recursive:true});
  context=await browser.newContext({viewport:{width:1500,height:1050},acceptDownloads:true});
  page=await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route('**/api/action',async route=>{
   try{
    require(activePhase!==null,'An unbound browser mutation was refused.');
    const request=route.request().postDataJSON();
    const phasePath=path.join(journal,activePhase+'.json');
    const prefix='groundwater:'+origin+'/api:';
    const pending=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),prefix+'pending');
    require(pending&&pending.request.operation_id===request.operation_id,'The UI did not retain the original request before dispatch.');
    const value={schema:'starforge.groundwater-browser-request.v1',operation_id:input.operation_id,workspace_id:input.workspace_id,phase:activePhase,request,pending};
    if(await exists(phasePath)){
     const prior=await readJSON(phasePath);
     require(stable(prior.request)===stable(request)&&prior.workspace_id===input.workspace_id,'The retained browser phase changed its original request.');
    }else await writeJSON(phasePath,value);
    await route.continue();
   }catch(e){routeError=e;await route.abort('failed');}
  });
  async function go(route){
   check();
   const target=new URL('/#'+route,origin);
   await page.goto(target.href);
   await page.locator('#project-select option[value="'+input.project_id+'"]').waitFor({state:'attached'});
   if(await page.locator('#project-select').inputValue()!==input.project_id){
    await page.locator('#project-select').selectOption(input.project_id);
   }
   // Selecting a project intentionally returns the UI to this page's inventory.
   // Persist that selection before reopening the requested original detail.
   await page.waitForFunction(({key,id})=>{
    try{return JSON.parse(localStorage.getItem(key))===id;}catch{return false;}
   },{key:'groundwater:'+origin+'/api:project',id:input.project_id});
   await page.goto(target.href);
   // A hash-only navigation does not cancel the selection's asynchronous refresh.
   // Reload the exact route so its first render uses the retained project.
   await page.reload();
   await page.waitForFunction(({hash,projectId,workspaceId})=>{
    const selected=document.getElementById('project-select');
    const identity=document.getElementById('workspace-identity');
    const content=document.getElementById('content');
    return location.hash===hash&&selected?.value===projectId&&
     identity?.textContent.startsWith(workspaceId+' · ')&&Boolean(content?.querySelector('.section-head, .card'));
   },{hash:target.hash,projectId:input.project_id,workspaceId:input.workspace_id});
   const detailId=decodeURIComponent(route.split('/')[1]||'');
   if(detailId)require(await page.locator('#content code').evaluateAll((nodes,id)=>nodes.some(node=>node.textContent===id),detailId),
    'The selected original detail did not render: '+route+'. '+await page.locator('#content').innerText());
   await page.locator('#actor').fill(input.actor);
   await page.locator('#actor').dispatchEvent('change');
   require((await api('/state?project_id='+encodeURIComponent(input.project_id))).workspace.id===input.workspace_id,'The original operator workspace changed.');
  }
  async function settle(){
   await page.locator('#activity').waitFor({state:'attached'});
   await page.waitForFunction(()=>!document.getElementById('activity').textContent,{},{timeout:180000});
   if(await page.locator('#recovery').isVisible()){
    const button=page.locator('#recover-request');
    if(await button.isEnabled())await button.click();
   }
   await page.locator('#recovery').waitFor({state:'hidden',timeout:180000});
  }
  async function perform(phase,action,fill){
   check();routeError=null;
   const phasePath=path.join(journal,phase+'.json');
   activePhase=phase;
   try{
    let saved=await exists(phasePath)?await readJSON(phasePath):null;
    if(saved){
     require(saved.operation_id===input.operation_id&&saved.workspace_id===input.workspace_id&&saved.request.action===action,'The original phase has another identity.');
     try{
      const prior=await api('/operations/'+encodeURIComponent(saved.request.operation_id));
      require(stable(prior.request)===stable(normalized(saved.request)),'Original request readback differs.');
      requests.push({phase,operation_id:prior.id,request_sha256:prior.request_sha256});
      return prior.result;
     }catch(e){if(e.code!=='operation_not_recorded')throw e;}
     require(saved.pending.dispatchUrl===origin+'/api/action','Return to the same original operator port to resume its retained request.');
     await page.goto(origin+'/');
     await page.evaluate(({key,pending})=>localStorage.setItem(key,JSON.stringify(pending)),{key:'groundwater:'+origin+'/api:pending',pending:saved.pending});
     await page.reload();
     await page.locator('#retry-request').waitFor();
     if(saved.pending.file){
      require(input.native_package&&saved.pending.file.sha256===input.native_package.sha256,'The pending upload needs its exact original file.');
      await exact(input.native_package.path,input.native_package);
      await page.locator('#recovery-file').setInputFiles(input.native_package.path);
     }
    }else await fill();
    const responsePromise=page.waitForResponse(response=>{
     if(!response.url().endsWith('/api/action'))return false;
     try{return response.request().postDataJSON().action===action;}catch{return false;}
    },{timeout:180000});
    if(saved)await page.locator('#retry-request').click();
    else{
     const form=page.locator('form[data-handler="'+fill.handler+'"]');
     await form.locator('button[type="submit"]').click();
    }
    let response;
    try{response=await responsePromise;}catch(e){if(routeError)throw routeError;throw e;}
    if(routeError)throw routeError;
    const body=await response.json();
    if(!response.ok())throw new Error('Original '+action+' rejected: '+JSON.stringify(body));
    saved=await readJSON(phasePath);
    const prior=await api('/operations/'+encodeURIComponent(saved.request.operation_id));
    require(stable(prior.request)===stable(normalized(saved.request)),'Committed original request differs.');
    await settle();
    requests.push({phase,operation_id:prior.id,request_sha256:prior.request_sha256});
    return prior.result;
   }finally{activePhase=null;}
  }
  function filled(handler,fn){fn.handler=handler;return fn;}
  async function enter(form,name,value){await form.locator('[name="'+name+'"]').fill(String(value));}
  async function pick(form,name,value){await form.locator('[name="'+name+'"]').selectOption(String(value));}
  async function review(kind,id,findings){
   const form=page.locator('form[data-handler="'+kind+'-review"]');
   for(const finding of findings){
    const reason=input.source_finding_reasons[finding.id];
    if(!reason&&finding.severity==='review')throw new Error('Actual finding requires named review: '+JSON.stringify(finding));
    if(finding.severity==='blocking')throw new Error('Actual source remains blocked: '+finding.id);
    if(reason){await pick(form,'finding:'+finding.id,'acknowledged');await enter(form,'finding_reason:'+finding.id,reason);}
   }
   await pick(form,'decision','approved');
   await enter(form,'reason','Named review of this exact publisher demonstration edition/result, its native source and stated limitations; no site calibration or customer acceptance is inferred.');
  }
  async function capture(name){
   const file=path.join(output,name+'.png'),metadata=path.join(journal,name+'-screenshot.json');
   if(await exists(metadata)){const row=await readJSON(metadata);await exact(file,row);screenshots.push(row);return;}
   if(await exists(file))throw new Error('Screenshot exists without its original identity: '+file);
   await page.screenshot({path:file,fullPage:false});
   const raw=await fs.readFile(file),row={path:name+'.png',bytes:raw.length,sha256:sha(raw)};
   await writeJSON(metadata,row);screenshots.push(row);
  }
  async function waitRun(id){
   const deadline=Date.now()+(input.run_timeout_seconds||7200)*1000;
   while(Date.now()<deadline){
    const current=await api('/runs/'+id);
    if(current.result&&!current.run.worker_active)return current;
    if(!current.run.worker_active&&['failed','interrupted'].includes(current.run.state))throw new Error('Original native attempt incomplete: '+JSON.stringify(current.run));
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
   throw new Error('The original native worker remains pending. Continue this same run after its outcome is known.');
  }

  if(mode==='restored'){
   await go('runs/'+input.scenario_run_id);
   await page.getByText('Native completion',{exact:true}).waitFor();
   await capture('07-restored-native');
   await go('reports/'+input.report_id);
   await page.getByText('Complete package manifest',{exact:true}).waitFor();
   const report=await api('/reports/'+input.report_id);
   await capture('08-restored-report');
   await go('history');
   const original=(await readJSON(path.join(output,'browser-operate-result.json'))).requests[0];
   const form=page.locator('#operation-read');
   await enter(form,'operation_id',original.operation_id);
   await form.locator('button[type="submit"]').click();
   await page.locator('#operation-result').waitFor({state:'visible'});
   const current=await api('/state?project_id='+input.project_id);
   require(current.backups.every(row=>row.status==='external_archive'),'Restored backup history incorrectly exposes a local archive.');
   require(current.runs.every(row=>!row.worker_active),'Restored UI started a native worker.');
   const result={schema:'starforge.groundwater-browser-result.v1',state:'complete',mode,operation_id:input.operation_id,workspace_id:input.workspace_id,scenario_run_id:input.scenario_run_id,report_id:input.report_id,report_sha256:report.report.sha256,requests:[],screenshots,automatic_native_execution:false};
   await context.close();context=null;await browser.close();
   await writeJSON(resultFile,result);
  }else{
   await go('sources/'+input.source_id);
   await page.locator('[data-view-source][data-path="publisher/examples/scripts/ex-gwf-twri.py"]').click();
   await page.locator('#source-viewer').waitFor({state:'visible'});
   require((await page.locator('#source-viewer-text').textContent()).includes('recharge = 3e-8'),'Actual unchanged publisher source was not displayed.');
   await capture('01-original-source');

   const imported=await perform('native-package-import','source.import',filled('source-import',async()=>{
    await go('sources');
    await exact(input.native_package.path,input.native_package);
    const form=page.locator('#source-import');
    await enter(form,'name','Complete files actually generated by the unchanged TWRI baseline');
    await form.locator('[name="file"]').setInputFiles(input.native_package.path);
    await enter(form,'mf6_namefile',input.native_package.mf6_namefile);
    await enter(form,'legacy_namefile',input.native_package.legacy_namefile);
    await enter(form,'layer_mapping','[[0,0],[2,1],[4,2]]');
    await enter(form,'intended_units','{"length":"feet","time":"seconds"}');
   }));
   const importedSource=await api('/sources/'+imported.source_id);
   require(!importedSource.source.findings.some(row=>row.severity==='blocking'),'The original generated package has unresolved literal native references.');
   await go('runs/'+input.baseline_run_id);
   await page.getByText('Native completion',{exact:true}).waitFor();
   await capture('02-original-native');

   const scenario=await perform('scenario-create','edition.create',filled('scenario-create',async()=>{
    await go('editions/'+input.reference_edition_id);
    const form=page.locator('form[data-handler="scenario-create"]');
    await enter(form,'name','Publisher demonstration: explicit recharge 4e-8');
    await enter(form,'description','Attributed parameter scenario from the reviewed compatible-unit reference. This numerical sensitivity example is not a customer recharge estimate.');
    await form.locator('[name="change_recharge"]').check();
    await enter(form,'recharge','4e-8');
    await enter(form,'recharge_reason','Explicit operator demonstration sensitivity from retained 3e-8 to selected 4e-8 feet/second; all original sources and other parameters remain attributable.');
   }));
   const edition=await api('/editions/'+scenario.id);
   await perform('scenario-review','edition.review',filled('edition-review',async()=>{
    await go('editions/'+scenario.id);await review('edition',scenario.id,edition.source.findings);
   }));
   await go('editions/'+scenario.id);await capture('03-reviewed-scenario');

   const queued=await perform('scenario-queue','run.create',filled('run-create',async()=>{
    await go('editions/'+scenario.id);
    await enter(page.locator('form[data-handler="run-create"]'),'reason','Execute both actual native solvers for the explicitly reviewed publisher recharge sensitivity scenario.');
   }));
   await perform('scenario-execute','run.execute',filled('run-execute',async()=>{
    await go('runs/'+queued.id);
    await enter(page.locator('form[data-handler="run-execute"]'),'reason','Start this exact queued run with its retained application, source, edition and verified runtime.');
   }));
   const native=await waitRun(queued.id);
   await perform('scenario-result-review','run.review',filled('run-review',async()=>{
    await go('runs/'+queued.id);await review('run',queued.id,native.result.findings);
   }));
   const comparison=await api('/runs/'+queued.id+'/compare?baseline_run_id='+input.reference_run_id);
   require(Object.values(comparison.engines).every(engine=>engine.grid_matches&&engine.units_match&&engine.steps.every(step=>step.physical_comparable)),'Actual reference/scenario physical comparison is incompatible.');
   await go('compare');
   const comparisonForm=page.locator('form[data-handler="comparison"]');
   await pick(comparisonForm,'run_id',queued.id);await pick(comparisonForm,'baseline_run_id',input.reference_run_id);
   await comparisonForm.locator('button[type="submit"]').click();
   await page.locator('#comparison-result').waitFor({state:'visible'});
   await capture('04-native-comparison');

   const frozen=await perform('report-freeze','report.freeze',filled('report-freeze',async()=>{
    await go('reports');
    const form=page.locator('#report-freeze');
    await pick(form,'run_id',queued.id);
    await enter(form,'title','USGS TWRI original, compatible reference and recharge scenario');
    await enter(form,'reason','Complete publisher demonstration package: actual original dual-solvers, explicit metadata and recharge changes, exact outputs and named technical review. No customer design or field measurement is asserted.');
    for(const id of [input.baseline_run_id,input.reference_run_id])await form.locator('[name="comparison_run_ids"][value="'+id+'"]').check();
   }));
   await go('reports/'+frozen.id);await capture('05-frozen-report');
   const receiver=await perform('receiver','receiver.save',filled('receiver-save',async()=>{
    await go('receiving');const form=page.locator('#receiver-save');
    await enter(form,'name','Independent publisher demonstration receiver');
    await enter(form,'directory',input.receiver_directory);
   }));
   const delivery=await perform('delivery','report.deliver',filled('report-deliver',async()=>{
    await go('receiving');const form=page.locator('#report-deliver');
    await pick(form,'report_id',frozen.id);await pick(form,'receiver_id',receiver.id);
    await enter(form,'reason','Deliver the complete frozen example and all original comparison files for independent readback.');
   }));
   await perform('delivery-readback','delivery.reconcile',filled('delivery-control',async()=>{
    await go('receiving');const form=page.locator('#delivery-control');
    await pick(form,'id',delivery.id);await pick(form,'mode','reconcile');
   }));
   // Full package bytes are read independently before the named receiving record.
   const report=await api('/reports/'+frozen.id);
   const receivedRow=(await api('/state?project_id='+input.project_id)).deliveries.find(row=>row.id===delivery.id);
   require(receivedRow?.state==='complete','Original delivery has not completed.');
   const packageBytes=await fs.readFile(path.join(input.receiver_directory,receivedRow.filename));
   require(packageBytes.length===receivedRow.bytes&&sha(packageBytes)===receivedRow.sha256,'Independent receiver package bytes differ.');
   const acknowledged=await perform('receiving-decision','delivery.acknowledge',filled('delivery-acknowledge',async()=>{
    await go('receiving');const form=page.locator('#delivery-acknowledge');
    await pick(form,'id',delivery.id);await pick(form,'decision','accepted');
    await enter(form,'by',input.receiving_actor);await enter(form,'occurred_on',new Date().toISOString());
    await enter(form,'reference','Original package SHA256 '+receivedRow.sha256);
    await enter(form,'reason','Accepted complete publisher example file delivery after independent exact-byte readback, including original source, both native engines, explicit scenarios and the reviewed unit limitations. This is package acceptance, not customer site-design approval.');
   }));
   await go('receiving');await capture('06-receiving');
   const backup=await perform('backup','backup.create',filled('backup-create',async()=>{
    await go('backup');await enter(page.locator('#backup-create'),'reason','Capture the stopped full original workspace, application, native attempts, exact reports and named receiving history for independent reopen.');
   }));
   const finalState=await api('/state?project_id='+input.project_id);
   require(finalState.backups.find(row=>row.id===backup.id)?.status==='complete','The original full backup did not complete.');
   const result={schema:'starforge.groundwater-browser-result.v1',state:'complete',mode,operation_id:input.operation_id,workspace_id:input.workspace_id,project_id:input.project_id,imported_source_id:imported.source_id,scenario_edition_id:scenario.id,scenario_run_id:queued.id,report_id:frozen.id,report_sha256:report.report.sha256,delivery_id:delivery.id,acknowledgment_id:acknowledged.id,backup_id:backup.id,requests,screenshots,comparison,completed_at:new Date().toISOString()};
   await context.close();context=null;await browser.close();
   await writeJSON(resultFile,result);
  }
  process.stdout.write(JSON.stringify({state:'complete',result:resultFile})+'\n');
 }finally{
  if(context)await context.close();
  await browser.close();
  process.removeListener('SIGTERM',halt);process.removeListener('SIGINT',halt);
 }
}
