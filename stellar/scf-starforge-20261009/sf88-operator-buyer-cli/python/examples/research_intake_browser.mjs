#!/usr/bin/env node
/**
 * Original Analysis browser continuation over one existing Research selection.
 *
 * The caller supplies a live original Analysis host and an owned Playwright
 * Page. Source capture, mapping, preview and import use the real browser
 * controls. Full exports/workbook/portable receiving stay in the original
 * research_document_workbook.py workflow.
 */
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const SCHEMA='stellar-forge.analysis-research-browser-receiving.v1';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function publish(path,value){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const tmp=path+'.'+randomUUID()+'.tmp',file=await open(tmp,'wx',0o600);
  try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}
  try{await rename(tmp,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}
  finally{await unlink(tmp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function selectedIdentity(value){
  return {connection:value.connection,expected_workspace_id:value.expected_workspace_id,dossier_id:value.dossier_id,
    family:value.family,selection:value.selection,expected_edition_sha256:value.expected_edition_sha256,
    name:value.name,title:value.title};
}
function safeUrl(value){
  const parsed=new URL(value);
  need(parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1'&&!parsed.username&&!parsed.password&&parsed.hash,
    'ORIGINAL_ANALYSIS_LOOPBACK_CAPABILITY_REQUIRED');
  return {url:parsed.href,origin:parsed.origin,token:parsed.hash.slice(1)};
}
async function artifact(path){const body=await readFile(path);return {name:path.split('/').at(-1),bytes:body.length,sha256:sha(body)};}

/** The existing same-operation receiver may call this with its owned page. */
export async function runResearchIntakeJourney({page,url,directory,selection,analysisWorkspaceId,
  waitSeconds=900,restore=false,expectedCapture=null}={}){
  need(page&&typeof page.goto==='function'&&typeof directory==='string','ORIGINAL_BROWSER_PAGE_REQUIRED');
  need(Number.isInteger(waitSeconds)&&waitSeconds>0&&waitSeconds<=3600,'WAIT_INVALID');
  const endpoint=safeUrl(url),root=resolve(directory),journalPath=join(root,'browser-journal.json');
  const identity={schema:SCHEMA,analysis_workspace_id:analysisWorkspaceId,selection:selectedIdentity(selection)};
  await mkdir(root,{recursive:true,mode:0o700});
  let journal=await readJson(journalPath);
  if(journal)need(same(journal.identity,identity),'RECEIVING_IDENTITY_CHANGED');
  else{journal={identity,requests:{},replies:{},browserStorage:{},interruptions:[],screenshots:{},completed:false};await publish(journalPath,journal);}
  const errors=[],routeErrors=[];
  page.setDefaultTimeout(Math.min(waitSeconds*1000,300000));
  const onError=error=>errors.push(String(error.message??error));
  page.on('pageerror',onError);
  const auth={'X-Analysis-Capability':endpoint.token};
  const api=async path=>{
    const response=await page.request.get(endpoint.origin+path,{headers:auth,timeout:Math.min(waitSeconds*1000,120000)});
    const result=await response.json();
    if(!response.ok())throw Object.assign(new Error(result.error??'ANALYSIS_READ_FAILED'),{status:response.status()});
    return result;
  };
  const storageKey='sf-analysis-research:'+analysisWorkspaceId,responseKey='sf-response-draft:'+analysisWorkspaceId;
  await page.addInitScript(({values})=>{for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);},
    {values:journal.browserStorage});
  const saveStorage=async()=>{
    journal.browserStorage=await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)]).filter(([,value])=>value!==null)),
      [storageKey,responseKey]);
    await publish(journalPath,journal);
  };
  const waitJob=async id=>{
    const deadline=Date.now()+waitSeconds*1000;
    while(true){
      const job=await api('/api/jobs/'+id);
      if(job.status!=='RUNNING')return job;
      need(Date.now()<deadline,'ORIGINAL_JOB_STILL_RUNNING:'+id);
      await new Promise(done=>setTimeout(done,250));
    }
  };
  const showCapture=async job=>{
    await page.evaluate(value=>window.researchIntake.open(value),job);
    await page.locator('[data-tab="research"]').click();
  };
  const click=async selector=>{
    await page.locator(selector).click();
    await page.waitForFunction(()=>document.getElementById('refresh')?.disabled===false);
  };
  const existingOrResume=async kind=>{
    const request=journal.requests[kind];
    need(request,'RETAINED_NATIVE_REQUEST_REQUIRED');
    try{return await api('/api/jobs/'+request.id);}
    catch(error){
      need(error.message==='ANALYSIS_JOB_NOT_FOUND','ORIGINAL_NATIVE_JOB_READ_FAILED');
      const response=await page.request.post(endpoint.origin+'/api/start/'+kind,{
        headers:{...auth,'Content-Type':'application/json'},data:request,timeout:120000});
      const observed=await response.json();
      need(response.ok()&&observed.id===request.id&&observed.kind===kind,'ORIGINAL_NATIVE_REQUEST_REPLAY_FAILED');
      journal.interruptions.push({kind:'request_replay',action:kind,request_id:request.id,
        outcome:'SAME_REQUEST_AFTER_ABSENT_NATIVE_READ'});
      await publish(journalPath,journal);
      return observed;
    }
  };
  const sourceRadio=async()=>{
    const index=await page.locator('input[name="research-source"]').evaluateAll((items,chosen)=>{
      const stable=value=>Object.keys(value).sort().map(key=>key+':'+String(value[key])).join('|');
      return items.findIndex(item=>{try{return stable(JSON.parse(item.value))===stable(chosen);}catch{return false;}});
    },selection.selection);
    return index;
  };
  const matchCapture=body=>same(selectedIdentity(body),identity.selection)&&/^[a-f0-9]{32}$/.test(body.id)&&
    typeof body.captured_at==='string'&&Number.isInteger(body.expected_revision);
  const startRoute=async route=>{
    const request=route.request(),kind=new URL(request.url()).pathname.split('/').at(-1);
    if(!['research-capture','response-preview','response-import'].includes(kind)){await route.continue();return;}
    try{
      const body=request.postDataJSON();
      if(kind==='research-capture')need(matchCapture(body),'CAPTURE_SELECTION_CHANGED');
      if(journal.requests[kind])need(same(journal.requests[kind],body),'ORIGINAL_REQUEST_ID_CHANGED:'+kind);
      else{journal.requests[kind]=body;await saveStorage();}
      // The first accepted capture HTTP reply is deliberately discarded. Its
      // exact request was retained before the original host receives it.
      const response=await route.fetch({timeout:Math.min(waitSeconds*1000,120000)}),observed=await response.json();
      journal.replies[kind]={status:response.status(),id:observed.id??null,kind:observed.kind??null,
        state:observed.status??null,error:observed.error??null};
      await publish(journalPath,journal);
      if(kind==='research-capture'&&response.ok()&&!journal.interruptions.some(value=>value.kind==='capture_reply')){
        need(observed.id===body.id&&observed.kind===kind,'CAPTURE_REPLY_ID_CHANGED');
        journal.interruptions.push({kind:'capture_reply',request_id:body.id,observed_status:observed.status,
          outcome:'ACTUAL_ACCEPTED_REPLY_DISCARDED'});
        await publish(journalPath,journal);await route.abort('failed');
      }else await route.fulfill({response});
    }catch(error){routeErrors.push(error.code??error.message);await route.abort('failed').catch(()=>{});}
  };
  if(!restore)await page.route('**/api/start/*',startRoute);
  try{
    await page.goto(endpoint.url);
    await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='Connected');
    need((await api('/api/state')).workspace_id===analysisWorkspaceId,'ANALYSIS_WORKSPACE_CHANGED');
    await page.locator('[data-tab="research"]').click();
    if(restore){
      const config=await api('/api/research-connections');
      need(config.configured===false,'RESTORE_MUST_OPEN_WITHOUT_RESEARCH_CONNECTION');
      need(expectedCapture?.id&&journal.requests['research-capture']?.id===expectedCapture.id,'RESTORE_CAPTURE_REQUIRED');
      const job=await api('/api/jobs/'+expectedCapture.id);
      need(job.kind==='research-capture'&&job.status==='COMPLETE'&&
        job.result.document_id===expectedCapture.document_id&&
        job.result.edition_sha256===expectedCapture.edition_sha256,'RESTORED_CAPTURE_CHANGED');
      await showCapture(job);
      await click('#research-map-source');
      await page.waitForFunction(name=>document.getElementById('response-source')?.value===name,selection.name);
      need(await page.locator('#response-columns tr').count()===job.result.mapping.columns.length,'RESTORED_MAPPING_CHANGED');
      need((await page.locator('#response-document-metadata').textContent()).includes(job.result.document_id),
        'RESTORED_SOURCE_PROVENANCE_MISSING');
      await page.setViewportSize({width:390,height:844});
      await page.locator('[data-tab="research"]').click();
      const screenshot=join(root,'analysis-research-restored-mobile.png');
      await page.screenshot({path:screenshot,fullPage:true});
      need(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'RESTORED_MOBILE_PAGE_OVERFLOW');
      need(errors.length===0,'BROWSER_SCRIPT_ERRORS');
      const result={schema:SCHEMA,phase:'restored',workspace_id:analysisWorkspaceId,capture_id:job.id,
        document_id:job.result.document_id,edition_sha256:job.result.edition_sha256,
        configured:config.configured,source_mapping_columns:job.result.mapping.columns.length,
        screenshot:await artifact(screenshot),browser_errors:errors};
      await publish(join(root,'browser-restored.json'),result);return result;
    }
    if(!journal.requests['research-capture']){
      await page.locator('#research-connection').selectOption(selection.connection);
      await click('#research-load-dossiers');
      while(await page.locator('#research-dossier option').evaluateAll((options,id)=>!options.some(option=>option.value===id),selection.dossier_id)){
        need(await page.locator('#research-more-dossiers').isEnabled(),'ORIGINAL_DOSSIER_NOT_IN_INVENTORY');
        await click('#research-more-dossiers');
      }
      await page.locator('#research-dossier').selectOption(selection.dossier_id);
      await page.locator('#research-family').selectOption(selection.family);
      await click('#research-load-sources');
      let chosen=await sourceRadio();
      while(chosen<0){
        need(await page.locator('#research-more-sources').isEnabled(),'ORIGINAL_OUTPUT_NOT_RETAINED');
        await click('#research-more-sources');chosen=await sourceRadio();
      }
      await page.locator('input[name="research-source"]').nth(chosen).check();
      await click('#research-review');
      await page.waitForFunction(digest=>document.getElementById('research-review-json')?.textContent.includes(digest),selection.expected_edition_sha256);
      const review=JSON.parse(await page.locator('#research-review-json').textContent());
      need(review.editionSha256===selection.expected_edition_sha256&&same(review.selection,selection.selection),'REVIEWED_EDITION_CHANGED');
      await page.locator('#research-source-name').fill(selection.name);
      await page.locator('#research-source-title').fill(selection.title);
      await click('#research-capture');
      await page.waitForFunction(()=>!!document.getElementById('research-pending-request')?.textContent||
        document.getElementById('research-capture-panel')?.hidden===false);
      const deadline=Date.now()+waitSeconds*1000;
      while(!journal.requests['research-capture']){need(Date.now()<deadline,'CAPTURE_REQUEST_NOT_RETAINED');await new Promise(done=>setTimeout(done,50));}
    }
    const captureRequest=journal.requests['research-capture'];
    need(matchCapture(captureRequest),'RETAINED_CAPTURE_SELECTION_CHANGED');
    let capture;
    try{capture=await api('/api/jobs/'+captureRequest.id);}
    catch(error){
      need(error.message==='ANALYSIS_JOB_NOT_FOUND','CAPTURE_READ_FAILED');
      // The actual saved pending request is restored by the UI and its
      // original recovery control repeats that same request only.
      await page.reload();await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='Connected');
      await page.locator('[data-tab="research"]').click();await click('#research-reopen-pending');
      capture=await api('/api/jobs/'+captureRequest.id);
    }
    if(['INTERRUPTED','FAILED','CANCELLED'].includes(capture.status)){
      await showCapture(capture);await click('#research-resume-capture');
    }
    capture=await waitJob(captureRequest.id);
    need(capture.status==='COMPLETE','CAPTURE_NATIVE_'+capture.status+':'+(capture.error??''));
    need(same(capture.request,captureRequest),'CAPTURE_REQUEST_CHANGED');
    await saveStorage();
    // Reopen the original browser with the accepted request and its durable
    // native job. No replacement capture is generated.
    await page.goto(endpoint.url);
    await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='Connected');
    await showCapture(capture);
    await click('#research-refresh-capture');
    await page.waitForFunction(()=>document.getElementById('research-map-source')?.disabled===false);
    await click('#research-map-source');
    await page.waitForFunction(name=>document.getElementById('response-source')?.value===name,selection.name);
    need(await page.locator('#response-columns tr').count()===capture.result.mapping.columns.length,'DEFAULT_OCCURRENCE_MAPPING_CHANGED');
    const sourceFacts=await page.locator('#response-source-info').textContent();
    const documentFacts=await page.locator('#response-document-metadata').textContent();
    need(sourceFacts.includes('Original SHA-256')&&documentFacts.includes(selection.title)&&documentFacts.includes(capture.result.document_id),'SOURCE_PROVENANCE_HANDOFF_CHANGED');
    if(!journal.requests['response-preview']){
      await click('#response-preview');
      const deadline=Date.now()+waitSeconds*1000;
      while(!journal.requests['response-preview']){need(Date.now()<deadline,'PREVIEW_REQUEST_NOT_RETAINED');await new Promise(done=>setTimeout(done,50));}
    }
    await existingOrResume('response-preview');
    const preview=await waitJob(journal.requests['response-preview'].id);
    need(preview.status==='COMPLETE','PREVIEW_NATIVE_'+preview.status);
    need(preview.request.source===selection.name&&preview.request.source_revision===capture.result.source.revision&&
      same(preview.request.mapping,capture.result.mapping),'PREVIEW_MAPPING_CHANGED');
    need(preview.result.manifest.rows===capture.result.receipt.rowCount,'PREVIEW_OCCURRENCE_COUNT_CHANGED');
    need(preview.result.manifest.completion.requiresIncompleteAcknowledgement===false,'EXPLICIT_INCOMPLETE_SOURCE_DECISION_REQUIRED');
    await page.evaluate(job=>window.responseTables.open(job),preview);
    if(!journal.requests['response-import']){
      await click('#response-import');
      const deadline=Date.now()+waitSeconds*1000;
      while(!journal.requests['response-import']){need(Date.now()<deadline,'IMPORT_REQUEST_NOT_RETAINED');await new Promise(done=>setTimeout(done,50));}
    }
    await existingOrResume('response-import');
    const imported=await waitJob(journal.requests['response-import'].id);
    need(imported.status==='COMPLETE','IMPORT_NATIVE_'+imported.status);
    need(imported.request.preview_id===preview.id&&imported.request.preview_sha256===preview.result.preview_sha256&&
      imported.result.version.row_count===capture.result.receipt.rowCount,'IMPORTED_EDITION_CHANGED');
    await saveStorage();
    await page.setViewportSize({width:1440,height:1080});
    await showCapture(capture);
    const desktop=join(root,'analysis-research-desktop.png');await page.screenshot({path:desktop,fullPage:true});
    await page.setViewportSize({width:390,height:844});
    const mobile=join(root,'analysis-research-mobile.png');await page.screenshot({path:mobile,fullPage:true});
    need(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'MOBILE_PAGE_OVERFLOW');
    need(errors.length===0&&routeErrors.length===0,'BROWSER_OR_REQUEST_ERRORS');
    journal.completed=true;journal.screenshots={desktop:await artifact(desktop),mobile:await artifact(mobile)};
    await publish(journalPath,journal);
    const result={schema:SCHEMA,phase:'captured_and_imported',workspace_id:analysisWorkspaceId,
      capture_id:capture.id,document_id:capture.result.document_id,edition_sha256:capture.result.edition_sha256,
      preview_id:preview.id,preview_sha256:preview.result.preview_sha256,
      import_id:imported.id,version_id:imported.result.version.version_id,rows:imported.result.version.row_count,
      requests:journal.requests,interruptions:journal.interruptions,screenshots:journal.screenshots,browser_errors:errors};
    await publish(join(root,'browser-complete.json'),result);return result;
  }finally{page.off('pageerror',onError);if(!restore)await page.unroute('**/api/start/*',startRoute);}
}

async function main(){
  let configText='';for await(const block of process.stdin)configText+=block;
  const config=JSON.parse(configText);
  need(typeof config.playwright==='string'&&typeof config.chromium==='string'&&typeof config.temporaryDirectory==='string',
    'ORIGINAL_INSTALLED_BROWSER_RUNTIME_REQUIRED');
  const {chromium}=await import(pathToFileURL(resolve(config.playwright)).href);
  const browser=await chromium.launch({executablePath:resolve(config.chromium),headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage'],env:{...process.env,TMPDIR:config.temporaryDirectory,TMP:config.temporaryDirectory,TEMP:config.temporaryDirectory}});
  const stop=()=>{process.exitCode=143;void browser.close().catch(()=>{});};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1080}});
    const page=await context.newPage();
    const result=await runResearchIntakeJourney({...config,page});
    process.stdout.write(JSON.stringify(result)+'\n');
  }finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);await browser.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write(JSON.stringify({ok:false,error:error.code??error.name,message:String(error.message)})+'\n');process.exitCode=1;});
}
