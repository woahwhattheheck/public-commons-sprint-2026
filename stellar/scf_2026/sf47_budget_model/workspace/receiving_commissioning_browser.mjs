// Continue the same retained native commissioning case through the original browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const OP='SCF-6966-CUSTOMER-COMMISSIONING-RECEIVING-20261013';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>JSON.stringify(value);
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
if(config.operationId!==OP)throw new Error('Continue the original commissioning operation.');
const nativeConfig=JSON.parse(await fs.readFile(config.nativeConfig,'utf8'));
const native=JSON.parse(await fs.readFile(config.nativeResult,'utf8'));
if(native.operationId!==OP||native.state!=='COMPLETE')throw new Error('Complete the original native source receiving first.');
const output=path.resolve(config.outputDirectory),source=path.resolve(nativeConfig.applicationDirectory);
await fs.mkdir(output,{recursive:true,mode:0o700});
const statePath=path.join(output,'browser-state.json'),configSha=sha(canonical(config));
let state;
try{state=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(state&&(state.operationId!==OP||state.configurationSha256!==configSha||state.caseId!==native.receivedCaseId))
  throw new Error('The browser checkpoint belongs to another original case or source.');
state??={operationId:OP,configurationSha256:configSha,caseId:native.receivedCaseId,steps:{},requests:[],sessions:{},state:'PREPARED'};
let saveTail=Promise.resolve();
const save=()=>{const raw=JSON.stringify(state,null,2)+'\n';const next=saveTail.then(async()=>{const tmp=statePath+'.next';await fs.writeFile(tmp,raw,{mode:0o600});await fs.rename(tmp,statePath);});saveTail=next.catch(()=>{});return next;};
await save();
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser,context,page,server,serverExit,serverError='',origin,announcement;
const errors=[],badResponses=[];
let pendingNetwork=[];
async function snapshot(){
  if(!page||page.isClosed())return;
  state.sessions=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('sf47.'))));
  await save();
}
async function step(name,fn){
  if(Object.hasOwn(state.steps,name))return state.steps[name];
  const result=await fn();
  state.steps[name]=result??{complete:true};await snapshot();await save();
  console.log(JSON.stringify({step:name,complete:true}));
  return result;
}
async function api(endpoint,body){
  return page.evaluate(async({endpoint,body})=>{
    const {staffRequest}=await import('/staff-session.mjs');
    return staffRequest(endpoint,body);
  },{endpoint,body});
}
const prefix='/api/operations/'+native.receivedCaseId;
const installationEndpoint=prefix+'/installations/'+native.installationId;
async function clickAction(name,extra=''){await page.locator('[data-installation-action="'+name+'"]'+extra).first().click();}
async function expectResponse(suffix,act){
  const received=page.waitForResponse(r=>r.url().endsWith(suffix)&&r.request().method()==='POST',{timeout:45000});
  await act();const response=await received;const value=await response.json();
  if(!response.ok())throw new Error(value.error?.message||value.error||value.message||'Original request failed '+response.status());
  return value;
}
async function openCase(){
  await page.getByRole('button',{name:'Delivery operations',exact:true}).click();
  const selector=page.locator('select[name="caseSelect"]');
  await selector.waitFor();
  if(await selector.inputValue()!==native.receivedCaseId)await selector.selectOption(native.receivedCaseId);
  await page.locator('[data-ops-tab="installations"]').click();
  await page.locator('[data-installation-action="open"][data-id="'+native.installationId+'"]').waitFor();
  const editing=await page.locator('[data-installation-editor]').count();
  if(!editing)await clickAction('open','[data-id="'+native.installationId+'"]');
  const actor=page.locator('input[name="recordingActor"]');
  if(await actor.count()&&!await actor.evaluate(el=>el.readOnly))await actor.fill('Authored commissioning browser receiving');
}
async function openEditor(){
  if(!await page.locator('[data-installation-editor]').count())await clickAction('edit');
  await page.locator('[data-commissioning-editor]').waitFor();
}
async function showRow(group,index){
  const key=group==='uses'?'uses.'+index+'.note':'funding.'+index+'.note';
  for(let tries=0;tries<200;tries++){
    const control=page.locator('[data-commissioning-field="'+key+'"]');
    if(await control.count())return control;
    const visible=await page.locator('[data-commissioning-field^="'+group+'."]').first().getAttribute('data-commissioning-field');
    const current=Math.floor(Number(visible.split('.')[1])/5),desired=Math.floor(index/5);
    const controls=page.locator('[data-installation-action="commissioning-page"][data-commissioning-group="'+group+'"]');
    const pagingControl=desired>current?controls.last():controls.first();
    if(await pagingControl.isDisabled())break;
    await pagingControl.click();
  }
  throw new Error('The exact retained commissioning row is not reachable.');
}
async function selectReview(kind,id,note){
  const button=page.locator('[data-installation-action="commissioning-review"][data-commissioning-kind="'+kind+'"][data-commissioning-id="'+id+'"]');
  const section=button.locator('xpath=ancestor::section[contains(@class,"commissioning-decision")][1]');
  await section.locator('select[data-decision-field="state"]').selectOption('APPROVED');
  await section.locator('textarea[data-decision-field="note"]').fill(note);
  await section.locator('[data-commissioning-review-select]').check();
}
async function currentDraft(){
  return page.evaluate(caseId=>{
    const saved=JSON.parse(sessionStorage.getItem('sf47.installations.'+caseId)||'null');
    if(!saved)throw new Error('Original editor checkpoint is absent.');
    const entry=saved.drafts?.[saved.draftKey]||Object.values(saved.drafts||{}).find(row=>row.installationId);
    if(!entry)throw new Error('Original complete draft is absent.');
    return entry.document;
  },native.receivedCaseId);
}
try{
  const pins=nativeConfig.applicationSourceSha256;
  for(const[name,expected]of Object.entries(pins))assert(sha(await fs.readFile(path.resolve(source,name)))===expected,'The operated source changed: '+name);
  const selectionCode='import sys,json;sys.path.insert(0,sys.argv[1]);from managed_launch import selection;print(json.dumps(selection(sys.argv[2],sys.argv[3],sys.argv[1])))';
  const selection=JSON.parse(execFileSync(config.pythonExecutable,['-B','-c',selectionCode,source,native.receivedWorkspace,nativeConfig.scenario],
    {encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
  server=spawn(config.pythonExecutable,['-B',path.join(source,'server.py'),'--workspace',native.receivedWorkspace,
    '--scenario',nativeConfig.scenario,'--startup-format','managed','--expected-selection-sha256',selection[1],'--source-directory',source],
    {stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  serverExit=new Promise(resolve=>server.once('close',(code,signal)=>resolve({code,signal})));
  server.stderr.on('data',data=>{serverError=(serverError+data.toString()).slice(-32000);});
  announcement=await new Promise((resolve,reject)=>{
    let buffer='';const timer=setTimeout(()=>reject(new Error('Original managed server did not announce: '+serverError)),30000);
    server.stdout.on('data',data=>{buffer+=data.toString();const end=buffer.indexOf('\n');if(end>=0){clearTimeout(timer);try{resolve(JSON.parse(buffer.slice(0,end)));}catch(error){reject(error);}}});
    server.once('error',error=>{clearTimeout(timer);reject(error);});
    server.once('exit',code=>{if(!buffer){clearTimeout(timer);reject(new Error('Original server exited '+code+': '+serverError));}});
  });
  origin=announcement.url;
  const privateLaunch=await read(path.join(native.receivedWorkspace,'managed-launch.json'));
  assert(privateLaunch.selectionSha256===selection[1]&&privateLaunch.url===origin,'Original launch selection differs.');
  const playwright=await import(pathToFileURL(config.playwrightModule).href);
  browser=await playwright.chromium.launch({executablePath:config.chromiumExecutable,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await context.addInitScript(sessions=>{if(!sessionStorage.getItem('sf47.receiving-restored')){for(const[k,v]of Object.entries(sessions))sessionStorage.setItem(k,v);sessionStorage.setItem('sf47.receiving-restored','1');}},state.sessions);
  page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=500)badResponses.push({url:response.url().replace(origin,''),status:response.status()});});
  page.on('request',request=>{
    if(request.method()==='POST'&&request.url()===origin+prefix+'/command'){
      const body=request.postDataJSON();
      const work=(async()=>{if(!state.requests.some(row=>row.requestId===body.requestId)){state.requests.push(body);await snapshot();}})();
      pendingNetwork.push(work);
    }
  });
  await page.goto(origin+'/#access='+privateLaunch.accessToken);
  await page.locator('#workbench').waitFor({state:'visible'});
  await openCase();
  const baseline=await step('retain-original-browser-basis',async()=>{
    const row=await api(installationEndpoint);const op=await api(prefix);
    return{revision:row.revision,sha256:row.sha256,document:row.preview.document,
      purchaseSha256:sha(canonical(op.records.purchases)),sourceSelectionSha256:selection[1]};
  });
  if(state.state==='COMPLETE'){console.log(JSON.stringify(state.result));}
  else{
    const targetIndex=baseline.document.commissioning.uses.findIndex(row=>row.cycleIds.length&&row.outputFiles.length);
    assert(targetIndex>=0,'The original native selection has no complete customer output.');
    const target=baseline.document.commissioning.uses[targetIndex],marker='Original browser receiving '+OP;
    const prepared=await step('edit-and-retain-complete-draft',async()=>{
      await openEditor();
      await page.locator('[data-commissioning-field="note"]').fill(marker);
      const note=await showRow('uses',targetIndex);await note.fill(target.note+' '+marker);
      const head=await api(installationEndpoint);
      const total=head.preview.report.commissioning.budget.selectedGroupBudgetsAtomic;
      assert(typeof total==='string','The original active group budgets are incomplete.');
      await page.locator('[data-commissioning-field="aggregateBudgetAtomic"]').fill(total);
      await page.locator('[data-installation-note]').fill('Review the original customer output correspondence in this same received case.');
      await snapshot();
      await page.locator('[data-ops-tab="sources"]').click();
      await page.locator('[data-ops-tab="installations"]').click();
      assert(await page.locator('[data-commissioning-field="note"]').inputValue()===marker,'Tab remount lost the complete draft.');
      await page.reload();await page.locator('#workbench').waitFor({state:'visible'});await openCase();await openEditor();
      assert(await page.locator('[data-commissioning-field="note"]').inputValue()===marker,'Refresh lost the complete draft.');
      const value=await expectResponse('/installation-commissioning-seed',()=>clickAction('commissioning-refresh'));
      return{document:value.document,report:value.report};
    });
    await step('review-original-price-plan-and-output',async()=>{
      await openEditor();
      const refreshed=await expectResponse('/installation-commissioning-seed',()=>clickAction('commissioning-refresh'));
      const doc=refreshed.document,report=refreshed.report;
      await page.locator('[data-commissioning-ui="actor"]').fill('Authored commissioning browser receiving');
      await page.locator('[data-commissioning-ui="observedAt"]').fill(new Date().toISOString());
      for(const row of report.funding.filter(row=>row.active&&!row.review.effectiveApproval)){
        assert(row.canApprove,'Complete original funding selection is not reviewable: '+row.reviewFindings.join(' '));
        const index=doc.commissioning.funding.findIndex(value=>value.fundingId===row.fundingId);
        await showRow('funding',index);
        await selectReview('FUNDING',row.fundingId,'Authored review of the exact original priced unit and source in the received case.');
      }
      await showRow('uses',targetIndex);
      const row=report.uses.find(value=>value.entryId===target.entryId);
      assert(row.canApprovePlan&&row.canAcceptOutput,'The original selected customer result is not reviewable.');
      await selectReview('PLAN',target.entryId,'Authored review of this original dated task and retained cycle correspondence.');
      await selectReview('OUTPUT',target.entryId,'Authored review of the exact complete original customer files.');
      await selectReview('BUDGET','budget','Authored review of the active funding-group aggregate; historical observations remain original.');
      const reviewed=await expectResponse('/installation-commissioning-review',()=>clickAction('commissioning-review-selected'));
      assert(reviewed.report.budget.review.effectiveApproval,'Exact budget review was not effective.');
      assert(reviewed.report.uses.find(row=>row.entryId===target.entryId).receivingReview.effectiveApproval,'Selected output review was not effective.');
      return{reviewed:reviewed.reviewed,summary:reviewed.report.summary,document:reviewed.document};
    });
    await step('save-with-original-lost-reply-recovery',async()=>{
      if(!state.committedBody){
        await openEditor();
        const preview=await expectResponse('/installation-preview',()=>clickAction('preview'));
        const initial=await api(installationEndpoint);
        state.saveBasis={revision:initial.revision,document:preview.document,requestCount:state.requests.length};await save();
        const endpoint=origin+prefix+'/command';
        let withheld=false;
        await page.route(endpoint,async route=>{
          const body=route.request().postDataJSON();
          if(!withheld&&body.action==='installation.save'){
            withheld=true;
            const response=await route.fetch();assert(response.ok(),'Original save was rejected before the lost-reply exercise.');
            const receipt=await response.json();
            state.committedReceipt=receipt;state.committedBody=body;await snapshot();await save();
            await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Authored lost-response exercise after original commit.'})});
          }else await route.continue();
        });
        await clickAction('save');
        await page.locator('[data-installation-action="recover"]').waitFor({state:'visible',timeout:45000});
        await snapshot();await page.unroute(endpoint);
        assert(withheld&&state.committedBody?.requestId,'The original save was not dispatched.');
        const stored=await page.evaluate(caseId=>JSON.parse(sessionStorage.getItem('sf47.installations.'+caseId)),native.receivedCaseId);
        assert(stored.pending?.body?.requestId===state.committedBody.requestId,'Ambiguous reply lost the exact pending request.');
      }
      const recovery=page.locator('[data-installation-action="recover"]');
      if(await recovery.count()){
        await expectResponse('/command',()=>recovery.click());
        await page.locator('[data-installation-action="edit"]').waitFor({state:'visible'});
      }else{
        // A producer interruption may follow the committed response. Reconcile
        // the same original request, without another draft or mutation identity.
        await api(prefix+'/command',state.committedBody);
        await clickAction('open','[data-id="'+native.installationId+'"]');
      }
      const after=await api(installationEndpoint),op=await api(prefix);
      assert(after.revision===state.saveBasis.revision+1,'Lost-reply recovery created another saved edition.');
      assert(sha(canonical(after.preview.document))===sha(canonical(state.saveBasis.document)),'Saved document differs from the reviewed draft.');
      assert(sha(canonical(op.records.purchases))===baseline.purchaseSha256,'Browser review changed original purchase observations.');
      await Promise.all(pendingNetwork);
      assert(state.requests.length===state.saveBasis.requestCount+1,'Recovery used a second mutation identity.');
      return{requestId:state.committedBody.requestId,revision:after.revision,sha256:after.sha256,summary:after.preview.report.commissioning.summary};
    });
    await step('export-original-complete-receiving',async()=>{
      const download=page.waitForEvent('download');await clickAction('export');const value=await download;
      const destination=path.join(output,'Commissioning_Complete_Browser_Handover.zip');await value.saveAs(destination);
      const bytes=await fs.readFile(destination),row=await api(installationEndpoint);
      return{path:destination,bytes:bytes.length,sha256:sha(bytes),revision:row.revision,installationSha256:row.sha256};
    });
    await step('inspect-mobile-and-original-sources',async()=>{
      await page.setViewportSize({width:390,height:844});
      await page.locator('[data-installation-action="edit"]').waitFor({state:'visible'});
      await page.screenshot({path:path.join(output,'mobile-inspection.png'),fullPage:true});
      const source=page.locator('[data-installation-action="source"]').first();assert(await source.count()>0,'Original source files are not accessible.');
      const download=page.waitForEvent('download');await source.click();const original=await download;
      const originalPath=path.join(output,'selected-original-'+path.basename(original.suggestedFilename()));
      await original.saveAs(originalPath);
      return{viewport:{width:390,height:844},originalBytes:(await fs.stat(originalPath)).size,originalSha256:sha(await fs.readFile(originalPath))};
    });
    assert(errors.length===0,'Browser errors: '+errors.join('; '));
    assert(badResponses.length<=1&&badResponses.every(row=>row.status===503&&row.url===prefix+'/command')&&state.committedBody,'Unexpected failed server responses: '+JSON.stringify(badResponses));
    state.state='COMPLETE';state.result={operationId:OP,state:'COMPLETE',caseId:native.receivedCaseId,installationId:native.installationId,
      originalNativeCaseId:native.caseId,sourceSelectionSha256:selection[1],steps:Object.keys(state.steps),javascriptErrors:errors,
      expectedLostResponse:1,originalPurchasesUnchanged:true,additionalConsoleRuns:0,additionalBuyerRequests:0,
      finalEdition:state.steps['save-with-original-lost-reply-recovery'],archive:state.steps['export-original-complete-receiving'],
      completedAt:new Date().toISOString()};
    await save();await fs.writeFile(path.join(output,'browser-result.json'),JSON.stringify(state.result,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(state.result));
  }
}catch(error){
  state.state='CONTINUATION_REQUIRED';state.failure={message:error.message,stack:error.stack,at:new Date().toISOString(),javascriptErrors:errors,serverError};
  try{await snapshot();if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'failure-inspection.png'),fullPage:true});}catch{}
  await save();console.error(JSON.stringify(state.failure));process.exitCode=1;
}finally{
  await Promise.allSettled(pendingNetwork);
  if(browser)await browser.close().catch(()=>{});
  if(server&&server.exitCode===null&&server.signalCode===null){server.kill('SIGTERM');await Promise.race([serverExit,wait(20000)]);}
}
