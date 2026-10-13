// MIT. Complete the amended Installation return on one borrowed native Page.
// The host owns the original server/client/browser and the cold receiver.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const SCHEMA='stellar-forge.sf47-installation-return-continuation.v1';
const ACTOR='Internal Installation receiving operator';
const EDITOR='sf47.installation-return-editor.v1';
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const ordered=x=>Array.isArray(x)?x.map(ordered):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const bytes=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
async function optional(file){try{return await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function atomic(file,raw){
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.'+randomUUID()+'.partial',handle=await fs.open(tmp,'wx',0o600);
  try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  await fs.rename(tmp,file);const parent=await fs.open(path.dirname(file),'r');try{await parent.sync();}finally{await parent.close();}
}
const wait=async(p,label)=>{
  let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error(label)),90000))]);}
  finally{clearTimeout(timer);}
};
const watched=p=>{p.catch(()=>{});return p;};

/**
 * page/client are the existing original authenticated application.
 * openOperations(page) selects its original Delivery operations tab.
 * restart() normally closes/reopens that same workspace and returns {page,client}.
 * openEmptyReceiver() closes that server, opens the owned empty receiving
 * directory at the same original origin and returns {page,client}.
 * Neither callback receives or exports a token. This module creates no service.
 */
export async function runInstallationReturnContinuation({
  page,client,preparedFile,outputDirectory,openOperations,restart,openEmptyReceiver,
}){
  need(page&&client&&typeof openOperations==='function'&&typeof restart==='function'&&typeof openEmptyReceiver==='function',
    'Use the original borrowed Page/client and owning restart/receiving callbacks.');
  need(path.isAbsolute(preparedFile)&&path.isAbsolute(outputDirectory),'Keep exact absolute native output paths.');
  await fs.mkdir(outputDirectory,{recursive:true,mode:0o700});
  const preparedRaw=await fs.readFile(preparedFile),prepared=JSON.parse(preparedRaw);
  need(prepared.schema===SCHEMA+'.prepared'&&prepared.state==='PREPARED','Use the complete prepared amended owner case.');
  const originalOrigin=new URL(page.url()).origin,caseId=prepared.caseId,key='sf47.installation-returns.'+caseId;
  const checkpoint=path.join(outputDirectory,'progress.json');
  const input={schema:SCHEMA+'.browser-input',operationId:prepared.operationId,preparedSha256:hash(preparedRaw),caseId,
    stageReview:prepared.stageReview,originalOrigin};
  const retainedInput=await optional(path.join(outputDirectory,'input.json'));
  if(retainedInput)need(same(JSON.parse(retainedInput),input),'Keep the same original browser receiving selection.');
  else await atomic(path.join(outputDirectory,'input.json'),bytes(input));
  const prior=await optional(checkpoint);
  const state=prior?JSON.parse(prior):{schema:SCHEMA+'.browser-progress',operationId:prepared.operationId,
    inputSha256:hash(bytes(input)),phases:{},issued:{},files:{}};
  need(state.schema===SCHEMA+'.browser-progress'&&state.operationId===prepared.operationId&&state.inputSha256===hash(bytes(input)),
    'The original browser continuation changed.');
  const persist=()=>atomic(checkpoint,bytes(state));
  const errors=[],pageError=error=>errors.push(String(error.stack||error));
  page.on('pageerror',pageError);
  const beforeViewport=page.viewportSize();
  async function artifact(name,make){
    need(name&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Keep a plain relative artifact name.');
    const file=path.join(outputDirectory,name),row=state.files[name];
    if(row){const raw=await fs.readFile(file);need(raw.length===row.bytes&&hash(raw)===row.sha256,'The retained complete browser output changed: '+name);return raw;}
    const raw=await optional(file)||await make();
    need(Buffer.isBuffer(raw)&&raw.length<=64*1024*1024,'Retain the complete native output within its original bound.');
    if(!await optional(file))await atomic(file,raw);
    state.files[name]={path:name,bytes:raw.length,sha256:hash(raw)};await persist();return raw;
  }
  const jsonArtifact=async(name,make)=>JSON.parse(await artifact(name,async()=>bytes(await make())));
  async function phase(name,call){
    if(state.phases[name])return state.phases[name];
    state.activePhase=name;await persist();
    const result=await call();state.phases[name]=result;delete state.activePhase;delete state.error;await persist();
    process.stdout.write(JSON.stringify({phase:name,status:'COMPLETE'})+'\n');return result;
  }
  const current=async(id=caseId)=>(await client.read('case',{caseId:id})).value;
  const session=async()=>page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)||'null'),key);
  async function settled(){await page.waitForFunction(k=>{const s=JSON.parse(sessionStorage.getItem(k)||'null');return s&&!s.pending&&!s.accepted;},key);}
  async function select(id=caseId){
    await openOperations(page);
    const selector=page.locator('.operations select[name="caseSelect"]');await selector.waitFor({state:'visible'});
    await selector.selectOption(id);
    await page.waitForFunction(id=>document.querySelector('.operations select[name="caseSelect"]')?.value===id&&
      document.querySelector('.operations')?.getAttribute('aria-busy')==='false',id);
    await page.locator('.operations [name="recordingActor"]').fill(ACTOR);
    await page.locator('.operations [data-ops-tab="installation-returns"]').click();
    await page.locator('.installation-return-desk').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.installation-return-desk')?.getAttribute('aria-busy')==='false');
  }
  async function openReview(id,selectedCase=caseId){
    await select(selectedCase);
    await page.locator('.installation-return-desk [data-return-action="mode"][data-mode="saved"]').click();
    await page.locator('.installation-return-desk [data-return-action="open-review"][data-review="'+id+'"]').click();
    await page.waitForFunction(id=>document.querySelector('.installation-return-desk')?.textContent.includes(id)&&
      document.querySelector('.installation-return-desk')?.getAttribute('aria-busy')==='false',id);
  }
  async function screenshot(name,width){
    await page.setViewportSize({width,height:960});
    const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
    need(layout.scrollWidth<=layout.width+1,'The original operating page overflows '+width+' pixels.');
    await artifact(name,()=>page.locator('.operations').screenshot({animations:'disabled'}));
    return layout;
  }
  async function download(name,click){
    return artifact(name,async()=>{
      const waiting=watched(page.waitForEvent('download'));await click();const item=await waiting;
      const file=path.join(outputDirectory,name);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
      await item.saveAs(file);
      need(!await item.failure(),'The original complete browser download failed.');
      const raw=await fs.readFile(file);need(raw.length>0&&raw.length<=32*1024*1024,'Keep the complete original bounded download.');
      await item.delete();return raw;
    });
  }
  async function replacePage(result){
    need(result?.page&&result?.client,'The original host must return the reopened Page and client.');
    page.off('pageerror',pageError);page=result.page;client=result.client;page.on('pageerror',pageError);
    need(new URL(page.url()).origin===originalOrigin,'The original host changed the receiving origin.');
  }
  async function recoverCommand(name,action,validate){
    let issued=state.issued[name],s=await session();
    if(!issued&&s?.pending){
      need(s.pending.body.action===action&&validate(s.pending.body),'A different original request owns the browser draft.');
      issued={caseId,body:s.pending.body};state.issued[name]=issued;await persist();
    }
    if(!issued)return null;
    need(issued.caseId===caseId&&issued.body.action===action&&validate(issued.body),'The retained original action changed.');
    if(s?.pending){
      need(same(s.pending.body,issued.body),'A later original request remains pending in this browser.');
      const waiting=watched(page.waitForResponse(r=>new URL(r.url()).pathname==='/api/operations/'+caseId+'/command'&&
        r.request().method()==='POST'&&r.request().postDataJSON()?.requestId===issued.body.requestId));
      await page.locator('.installation-return-desk [data-return-action="resume"]').click();
      const response=await wait(waiting,'The original request did not resume.');
      need(response.ok(),'The original native request still requires its saved correction.');
      const actual=await response.json();
      if(issued.result)need(same(actual,issued.result),'The exact native replay changed its original result.');
      issued.result=actual;await persist();await settled();
    }else if(s?.accepted){
      need(same(s.accepted.body,issued.body),'Another accepted result requires readback first.');
      await page.locator('.installation-return-desk [data-return-action="readback"]').click();await settled();
    }
    const before=await current(),replayed=await client.command(caseId,issued.body),after=await current();
    if(issued.result)need(same(replayed.value,issued.result),'The typed original request replay changed its receipt.');
    else{issued.result=replayed.value;await persist();}
    if(issued.result.version<=before.program.version)need(after.program.version===before.program.version,'Completed replay added an operating event.');
    await artifact('requests/'+name+'.json',async()=>bytes(issued.body));
    await artifact('receipts/'+name+'.json',async()=>bytes(issued.result));
    return issued.result;
  }
  async function uiCommand(name,action,validate,click,{loseReply=false}={}){
    const recovered=await recoverCommand(name,action,validate);if(recovered)return recovered;
    let finish,fail;const done=watched(new Promise((resolve,reject)=>{finish=resolve;fail=reject;}));
    const routePattern='**/api/operations/'+caseId+'/command';
    const handler=async route=>{
      let response;
      try{
        const body=route.request().postDataJSON();
        need(body.action===action&&validate(body),'The native UI selected another action or stage.');
        need(!state.issued[name],'The browser issued more than one request for this phase.');
        state.issued[name]={caseId,body};await persist();
        response=await route.fetch();
        const raw=await response.body(),actual=JSON.parse(raw);
        need(response.ok(),'The original native save failed: '+JSON.stringify(actual));
        state.issued[name].result=actual;state.issued[name].lostReply=loseReply;await persist();
        if(loseReply)await route.abort('connectionreset');else await route.fulfill({response});
        finish(actual);
      }catch(error){fail(error);try{await route.abort();}catch{}}
      finally{if(response)await response.dispose();}
    };
    await page.route(routePattern,handler);
    let result;
    try{await click();result=await wait(done,'The original UI request did not complete.');}
    finally{await page.unroute(routePattern,handler);}
    if(loseReply){
      await page.waitForFunction(k=>!!JSON.parse(sessionStorage.getItem(k)||'null')?.pending,key);
      const pending=await session();need(same(pending.pending.body,state.issued[name].body),'The original uncertain request was replaced.');
      await artifact('requests/'+name+'-uncertain.json',async()=>bytes(pending.pending.body));
      await page.reload({waitUntil:'domcontentloaded'});await select();
      result=await recoverCommand(name,action,validate);
    }else{
      await settled();result=await recoverCommand(name,action,validate);
    }
    return result;
  }

  try{
    const completed=await optional(path.join(outputDirectory,'result.json'));
    if(completed){
      const result=JSON.parse(completed);need(result.schema===SCHEMA+'.browser'&&result.operationId===prepared.operationId,'The retained browser result changed.');
      for(const row of result.files){const raw=await fs.readFile(path.join(outputDirectory,row.path));need(raw.length===row.bytes&&hash(raw)===row.sha256,'The completed browser artifact changed.');}
      return result;
    }
    await artifact('Prepared_Original_Selection.json',async()=>preparedRaw);
    await phase('original_staged_and_current_difference',async()=>{
      await openReview(prepared.stageReview.id);
      const seed=(await client.installationReturnReviewSeed(caseId,{expectedVersion:(await current()).program.version,retainedReview:prepared.stageReview})).value;
      need(!seed.application.canSave&&seed.application.installationChanges.length>0,'The complete cold owner lost its actual staged/current difference.');
      need(seed.inputs.retainedReview.id===prepared.stageReview.id&&seed.inputs.choices.every(x=>x.action==='KEEP'),'The retained seed implicitly applied earlier decisions.');
      await artifact('Typed_Retained_Review_Seed.json',async()=>bytes(seed));
      await page.locator('[data-return-stage-state="changed"]').waitFor({state:'visible'});
      need(await page.locator('[data-return-action="stage-preview"]').isDisabled(),'A stale stage remained available for immediate preview.');
      const desktop=await screenshot('views/staged-current-1365.png',1365),mobile=await screenshot('views/staged-current-390.png',390);
      return{originalReview:prepared.stageReview,currentInstallation:seed.application.currentInstallation,desktop,mobile};
    });
    await phase('regenerate_complete_owner_draft_and_reopen',async()=>{
      const existing=await session();
      if(state.issued['owner-stage']||existing?.pending?.body?.action==='installation.return-stage')return{recoveredIssued:true};
      await openReview(prepared.stageReview.id);
      await page.locator('[data-return-action="regenerate-stage"]').click();
      await page.locator('[data-return-field="choices.0.action"]').waitFor({state:'visible'});
      need(await page.locator('[data-return-field="choices.0.action"]').inputValue()==='KEEP','Regeneration reused an old owner approval.');
      await page.locator('[data-return-field="name"]').fill('Current amended owner review after the receiving-office correction');
      await page.locator('[data-return-field="note"]').fill('Review the complete retained return against this current Installation. Preserve its new final criterion and apply only the two unchanged observations.');
      for(let i=0;i<3;i++){
        await page.locator('[data-return-field="choices.'+i+'.action"]').selectOption(i<2?'APPLY':'KEEP');
        await page.locator('[data-return-field="choices.'+i+'.note"]').fill(i<2?
          'Explicit current owner decision on the unchanged criterion and complete original receiving files.':
          'The current final criterion changed. Keep it open and retain the earlier return as historical evidence.');
      }
      await page.locator('[data-return-save-note]').fill('Named internal owner review of this exact current Installation and retained original return.');
      const raw=await download('Complete_Regenerated_Owner_Draft.json',()=>page.locator('[data-return-action="draft-download"]').click());
      const original=JSON.parse(raw);need(original.schema===EDITOR&&original.caseId===caseId&&same(original.draft.inputs.retainedReview,prepared.stageReview),'The complete draft lost its retained source identity.');
      await page.reload({waitUntil:'domcontentloaded'});await select();
      need(await page.locator('[data-return-field="note"]').inputValue()===original.draft.inputs.note,'Normal reopen lost later owner text.');
      for(let i=0;i<3;i++)need(await page.locator('[data-return-field="choices.'+i+'.action"]').inputValue()===original.draft.inputs.choices[i].action,'Normal reopen lost an explicit decision.');
      return{draftSha256:hash(raw),retainedReview:original.draft.inputs.retainedReview,decisions:original.draft.inputs.choices};
    });
    await phase('original_owner_stage_uncertain_reply_and_exact_replay',async()=>{
      await select();
      const validate=body=>same(body.data?.inputs?.retainedReview,prepared.stageReview)&&body.data?.inputs?.installationId===prepared.installationId;
      let result=await recoverCommand('owner-stage','installation.return-stage',validate);
      if(!result){
        const waiting=watched(page.waitForResponse(r=>new URL(r.url()).pathname==='/api/operations/'+caseId+'/installation-return-review-preview'));
        await page.locator('[data-return-action="preview"]').click();const response=await waiting;
        need(response.ok(),'The current owner comparison could not be prepared.');const preview=await response.json();
        need(preview.appliedChecks===2&&preview.checks.slice(0,2).every(x=>x.eligible)&&!preview.checks[2].eligible,
          'The explicit partial review changed the selected current criteria.');
        await artifact('Current_Owner_Comparison.json',()=>response.body());
        result=await uiCommand('owner-stage','installation.return-stage',validate,()=>page.locator('[data-return-action="save"]').click(),{loseReply:true});
      }
      const row=(await client.read('review',{caseId,reviewId:result.recordId})).value;
      need(row.sha256===result.reviewSha256&&row.installationReturnReview.appliedChecks===2,'The saved original review differs from the exact native receipt.');
      state.review={id:row.id,sha256:row.sha256};await persist();
      await artifact('Current_Saved_Owner_Review.json',async()=>bytes(row));
      return{review:state.review,requestId:state.issued['owner-stage'].body.requestId,lostReplyRecovered:true};
    });
    await phase('original_preview_and_source_bound_installation_save',async()=>{
      const validate=body=>same(body.data?.returnReview,state.review)&&body.data?.installationId===prepared.installationId;
      await openReview(state.review.id);
      let result=await recoverCommand('installation-save','installation.save',validate);
      if(!result){
        await page.locator('[data-return-installation-note]').fill('Save the exact current owner stage, retaining two accepted observations and the changed open criterion.');
        const waiting=watched(page.waitForResponse(r=>new URL(r.url()).pathname==='/api/operations/'+caseId+'/installation-preview'));
        await page.locator('[data-return-action="stage-preview"]').click();const response=await waiting;
        need(response.ok(),'The original staged Installation preview did not complete.');
        const preview=await response.json();need(same(preview.returnReview,state.review),'The original preview lost its staged review binding.');
        await artifact('Original_Installation_Preview.json',()=>response.body());
        result=await uiCommand('installation-save','installation.save',validate,()=>page.locator('[data-return-action="stage-save"]').click());
      }
      const row=(await client.read('installation',{caseId,installationId:result.recordId,revision:result.revision})).value;
      need(row.sha256===result.sha256&&same(row.preview.returnReview,state.review),'The native Installation lost the exact original stage.');
      need(same(row.preview.document.checks.map(x=>x.state),['ACCEPTED','ACCEPTED','OPEN']),'The current partial receiving state changed.');
      state.installation={id:row.id,revision:row.revision,sha256:row.sha256};await persist();
      await artifact('Confirmed_Current_Installation.json',async()=>bytes(row));
      return{installation:state.installation,review:state.review,requestId:state.issued['installation-save'].body.requestId};
    });
    await phase('complete_owner_files_and_later_local_draft',async()=>{
      await openReview(state.review.id);
      const review=await download('Complete_Current_Owner_Review.json',()=>page.locator('[data-return-action="review-download"]').click());
      need(JSON.parse(review).sha256===state.review.sha256,'The full browser review download changed.');
      const archive=await download('Complete_Reviewed_Owner_Case.zip',()=>page.locator('[data-return-action="export"]').click());
      await screenshot('views/confirmed-installation-1365.png',1365);
      await screenshot('views/confirmed-installation-390.png',390);
      await page.locator('[data-return-action="regenerate-stage"]').click();
      await page.locator('[data-return-field="note"]').fill('Later unsaved receiving-office note retained after the confirmed Installation. This draft is a separate future decision.');
      const local=await download('Later_Unsaved_Owner_Draft.json',()=>page.locator('[data-return-action="draft-download"]').click());
      const draft=JSON.parse(local);state.laterDraftNote=draft.draft.inputs.note;await persist();
      const before=(await current()).program.version;
      const replay=await client.command(caseId,state.issued['installation-save'].body);
      need(same(replay.value,state.issued['installation-save'].result)&&(await current()).program.version===before,'Exact original save replay changed later work.');
      await replacePage(await restart());await select();
      need(await page.locator('[data-return-field="note"]').inputValue()===state.laterDraftNote,'Same-origin application restart discarded the later local owner draft.');
      await artifact('Original_Save_Replay.json',async()=>replay.bytes);
      return{archive:{bytes:archive.length,sha256:hash(archive)},laterDraftSha256:hash(local),replayedVersion:before};
    });
    await phase('complete_customer_ui_import_and_cold_reopen',async()=>{
      if(!state.receiverOpened){
        await replacePage(await openEmptyReceiver());state.receiverOpened=true;await persist();
      }else await replacePage(await openEmptyReceiver());
      await openOperations(page);
      await page.locator('.operations [name="recordingActor"]').fill(ACTOR);
      const archive=await fs.readFile(path.join(outputDirectory,'Complete_Reviewed_Owner_Case.zip'));
      if(!state.importRequest){
        let resolveDone,rejectDone;const received=watched(new Promise((r,j)=>{resolveDone=r;rejectDone=j;}));
        const routePattern='**/api/operations/import?*';
        const handler=async route=>{
          let response;
          try{
            const request=route.request(),raw=request.postDataBuffer(),headers=request.headers();
            need(raw&&raw.equals(archive),'The native UI imported different complete bytes.');
            const body={name:new URL(request.url()).searchParams.get('name'),requestId:headers['x-request-id'],
              actor:decodeURIComponent(headers['x-recorded-by']||'')};
            need(body.name&&body.requestId&&body.actor===ACTOR,'The native import lost its original selected identity.');
            state.importRequest={body,bytes:raw.length,sha256:hash(raw)};await persist();
            response=await route.fetch();need(response.ok(),'The complete customer import failed: '+await response.text());
            const result=await response.json();state.importResult=result;await persist();
            await route.fulfill({response});resolveDone(result);
          }catch(e){rejectDone(e);try{await route.abort();}catch{}}
          finally{if(response)await response.dispose();}
        };
        await page.route(routePattern,handler);
        try{
          await page.locator('.operations [data-ops-import]').setInputFiles(path.join(outputDirectory,'Complete_Reviewed_Owner_Case.zip'));
          const form=page.locator('dialog.ops-dialog[open] [data-ops-form]');await form.waitFor({state:'visible'});
          await form.locator('[name="name"]').fill('Complete amended Installation customer receiving');
          await form.locator('button[type="submit"]').click();
          await wait(received,'The original complete customer UI import did not return.');
        }finally{await page.unroute(routePattern,handler);}
      }
      need(state.importRequest.bytes===archive.length&&state.importRequest.sha256===hash(archive),'The original retained import source changed.');
      const imported=await client.importBundle('case',archive,state.importRequest.body);
      if(state.importResult)need(same(imported.value,state.importResult),'Original import replay created a different receiving case.');
      else{state.importResult=imported.value;await persist();}
      state.receivedCaseId=imported.value.id;await persist();
      await artifact('Customer_Original_Import_Request.json',async()=>bytes(state.importRequest));
      await artifact('Customer_Original_Import_Receipt.json',async()=>imported.bytes);
      await openReview(state.review.id,state.receivedCaseId);
      const row=(await client.read('installation',{caseId:state.receivedCaseId,installationId:state.installation.id,revision:state.installation.revision})).value;
      need(row.sha256===state.installation.sha256&&same(row.preview.returnReview,state.review),'The customer receiving changed the original native edition.');
      const seed=(await client.installationReturnReviewSeed(state.receivedCaseId,{expectedVersion:(await current(state.receivedCaseId)).program.version,retainedReview:state.review})).value;
      need(seed.savedInstallations.some(x=>x.sha256===state.installation.sha256),'Cold receiving lost the exact accepted stage identity.');
      await artifact('Customer_Retained_Review_Seed.json',async()=>bytes(seed));
      await download('Customer_Complete_Received_Case.zip',()=>page.locator('[data-return-action="export"]').click());
      await screenshot('views/customer-received-1365.png',1365);await screenshot('views/customer-received-390.png',390);
      await replacePage(await restart());await openReview(state.review.id,state.receivedCaseId);
      const reopened=(await client.read('installation',{caseId:state.receivedCaseId,installationId:state.installation.id,revision:state.installation.revision})).value;
      need(reopened.sha256===state.installation.sha256,'Closed/reopened customer receiving changed the complete Installation.');
      await artifact('Customer_Reopened_Installation.json',async()=>bytes(reopened));
      return{receivedCaseId:state.receivedCaseId,originalCaseId:caseId,installation:state.installation,review:state.review};
    });
    need(errors.length===0,'The original Page reported JavaScript errors: '+errors.join('\n'));
    const result={schema:SCHEMA+'.browser',state:'COMPLETE',status:'PASS',operationId:prepared.operationId,
      caseId,receivedCaseId:state.receivedCaseId,review:state.review,installation:state.installation,
      checks:state.phases,files:Object.values(state.files).sort((a,b)=>a.path.localeCompare(b.path)),javascriptErrors:errors};
    await atomic(path.join(outputDirectory,'result.json'),bytes(result));return result;
  }catch(error){
    state.error={message:error.message,stack:error.stack,javascriptErrors:errors};await persist();throw error;
  }finally{
    page.off('pageerror',pageError);if(beforeViewport&&!page.isClosed())await page.setViewportSize(beforeViewport);
  }
}
