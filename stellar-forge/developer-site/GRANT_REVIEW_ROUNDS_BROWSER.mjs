// MIT. Borrow the original receiving Page; use the real review UI and shared draft store.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { importReviewRound, exportReviewRound, reviewRoundView, compareReviewDraft, reviewSha256 } from './dist/grant-review-round-core.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const sha=body=>createHash('sha256').update(body).digest('hex');
const git=body=>createHash('sha1').update('blob '+body.length+'\0').update(body).digest('hex');
const observed=promise=>{promise.catch(()=>{});return promise;};
function need(value,message){if(!value)throw new Error(message);}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
const REQUIRED=['grant-review-round.html','grant-review-round.css','grant-review-round-core.mjs',
  'grant-review-round-workspace.mjs','grant-submission-core.mjs','drafts.mjs'];
function file(path,body,type='application/octet-stream'){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(body,'utf8');
  return {path,bytes:bytes.length,sha256:sha(bytes),mime:type,encoding:'base64',content:bytes.toString('base64')};
}
function verifyFile(row){
  need(row&&row.encoding==='base64'&&typeof row.path==='string'&&!row.path.startsWith('/')&&!row.path.split('/').includes('..'),'Retain a relative complete receiving artifact.');
  const body=Buffer.from(row.content,'base64');need(body.toString('base64')===row.content&&body.length===row.bytes&&sha(body)===row.sha256,'A retained browser artifact changed: '+row.path);return body;
}
/**
 * The caller owns Page, browser, listener, output storage and its original operation.
 * retain(checkpoint) must save the complete provided object with the caller's normal atomic/CAS writer.
 * Resume supplies that same checkpoint and the same original browser store. No new browser is launched.
 */
export async function runGrantReviewBrowser({
  page,baseUrl,fixtures,sourceFiles,operationId='SCF-SUBMISSION-REVIEW-ROUND-7108-20261012-BROWSER',
  checkpoint=null,retain=async()=>{},timeoutMs=60000
}={}){
  need(page&&typeof page.goto==='function'&&typeof page.evaluate==='function','Pass the original receiving Page.');
  need(fixtures?.firstCapture&&fixtures.editedCapture&&fixtures.latestCapture&&fixtures.fieldId,'Retain all three full native draft exports from the completed source-model receiving.');
  need(typeof retain==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000,'Use the existing complete checkpoint writer and browser timeout.');
  const base=new URL(baseUrl.endsWith('/')?baseUrl:baseUrl+'/');
  need(!base.username&&!base.password&&(base.protocol==='https:'||(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))),
    'Use the existing authenticated HTTPS or loopback application host.');
  need(typeof operationId==='string'&&/^[a-zA-Z0-9._:-]{1,160}$/.test(operationId),'Retain the original browser operation identity.');
  need(Array.isArray(sourceFiles)&&new Set(sourceFiles.map(x=>x.route)).size===sourceFiles.length,'Supply the complete selected browser source identities.');
  for(const name of REQUIRED)need(sourceFiles.some(x=>x.route===name||x.route==='/'+name),'The selected source omits '+name);
  const selection={schema:'stellar-forge.grant-review-browser-selection.v1',operationId,baseUrl:base.href,
    sourceFiles:clone(sourceFiles),originalExports:[fixtures.firstCapture,fixtures.editedCapture,fixtures.latestCapture].map(x=>({id:x.id,bytes:x.bytes,draftSha256:x.draftSha256})),
    fieldId:fixtures.fieldId,reviewerLabel:'Automated UI receiving reviewer — '+operationId,authorLabel:'Automated UI receiving author — '+operationId};
  const selectionSha256=sha(Buffer.from(JSON.stringify(selection)));
  let state=checkpoint?clone(checkpoint):{schema:'stellar-forge.grant-review-browser-checkpoint.v1',operationId,selectionSha256,selection,
    phase:'PREPARED',recordId:null,originalRecordId:null,roundId:null,artifacts:[],views:[],originalRoundExport:null,receivedRecordId:null,completedAt:null};
  need(state.schema==='stellar-forge.grant-review-browser-checkpoint.v1'&&state.operationId===operationId&&state.selectionSha256===selectionSha256&&same(state.selection,selection),
    'Resume the same browser operation, complete source, original exports and host.');
  for(const row of state.artifacts)verifyFile(row);
  const put=row=>{const previous=state.artifacts.find(x=>x.path===row.path);if(previous)need(same(previous,row),'Retain the earlier complete browser artifact '+row.path);else state.artifacts.push(row);};
  const persist=async phase=>{state.phase=phase;await retain(clone(state));};
  if(state.phase==='COMPLETE'){
    need(state.result?.state==='COMPLETE'&&state.originalRoundExport,'Retain the complete original browser result.');
    await importReviewRound(state.originalRoundExport);return {result:clone(state.result),checkpoint:state,artifacts:clone(state.artifacts)};
  }
  const errors=[],onError=error=>errors.push({type:'pageerror',message:error.message});
  const failedRequest=request=>{if(request.url().startsWith(base.href))errors.push({type:'requestfailed',url:request.url(),message:request.failure()?.errorText||'Request failed'});};
  page.on('pageerror',onError);page.on('requestfailed',failedRequest);
  async function idle(){
    await page.waitForFunction(()=>document.querySelector('#review-workspace')&&!document.querySelector('#review-workspace').inert,null,{timeout:timeoutMs});
    const current=await page.locator('#review-error').textContent();
    if(await page.locator('#review-error').isVisible())throw new Error('Original review UI: '+current);
  }
  async function current(){
    await idle();
    const recordId=await page.locator('#review-workspace').getAttribute('data-review-record-id');
    need(recordId,'The current complete review is not saved. Preserve its full UI export before leaving this original page.');
    const record=await page.evaluate(async id=>{const store=await import('./drafts.mjs');return store.loadDraft(id);},recordId);
    need(record?.input?.schema==='stellar-forge.grant-review-round.v1','Reopen the original shared-store review record.');
    const view=await reviewRoundView(record.input);need(record.input.id===state.roundId&&record.input.title===operationId,'The original review selection changed.');
    state.recordId=recordId;state.latestRound=record.input;state.latestBrowserRevision=record.revision;
    return {record,round:record.input,view};
  }
  async function upload(button,body,name){
    await button.click();await page.locator('#review-file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(body,'utf8')});
    await idle();
  }
  async function tab(name){await page.locator('[data-review-view="'+name+'"]').last().click();await idle();}
  async function actor(label){
    const value=await page.locator('#review-person option').evaluateAll((nodes,label)=>nodes.find(x=>x.textContent===label)?.value||null,label);
    need(value,'Retain the original named browser participant.');await page.locator('#review-person').selectOption(value);await idle();return value;
  }
  async function target(key){await page.locator('[data-target="'+key+'"]').click();await idle();}
  const note=step=>'Automated UI receiving '+operationId+' / '+step+'. No human or issuer approval is recorded.';
  async function ensure(kind,step,run,check){
    let saved=await current(),matches=saved.round.events.filter(x=>x.kind===kind&&x.input.note===note(step));
    need(matches.length<=1,'More than one original browser action is bound to '+step);
    if(!matches.length){need(saved.view.status==='OPEN'||kind==='reopen','Reconcile the original completed round before another browser action.');await run();saved=await current();matches=saved.round.events.filter(x=>x.kind===kind&&x.input.note===note(step));}
    need(matches.length===1,'The original browser action was not retained: '+step);check?.(matches[0],saved);
    await persist(state.phase==='RECEIVING'?'RECEIVING':'WORKING');return matches[0];
  }
  async function download(button,path,type){
    const retained=state.artifacts.find(x=>x.path===path);
    if(retained){need(retained.mime===type,'Retain the original download type for '+path);return verifyFile(retained);}
    const pending=observed(page.waitForEvent('download',{timeout:timeoutMs}));
    await button.click();const selected=await pending,error=await selected.failure();need(!error,'The original browser download failed: '+error);
    const stream=await selected.createReadStream();need(stream,'The original complete download is unavailable.');
    const chunks=[];let bytes=0;for await(const chunk of stream){bytes+=chunk.length;need(bytes<=64*1024*1024+65536,'Retain the download within its original complete allowance.');chunks.push(chunk);}
    await idle();const row=file(path,Buffer.concat(chunks),type);put(row);return verifyFile(row);
  }
  async function saveSelectedBrowserCopy({key,round,exportText,phase,sourceRecordId}){
    const roundSha256=sha(Buffer.from(JSON.stringify(round),'utf8'));
    need(same(await importReviewRound(exportText),round),'Retain the complete selected browser-copy input.');
    state.copyIntents??={};
    let intent=state.copyIntents[key];
    if(!intent){
      const existingRecordIds=await page.evaluate(async()=>{const store=await import('./drafts.mjs');return (await store.listDrafts()).map(x=>x.id);});
      need(Array.isArray(existingRecordIds)&&new Set(existingRecordIds).size===existingRecordIds.length,'Retain the original browser-store selection.');
      intent={schema:'stellar-forge.grant-review-browser-copy-intent.v1',key,operationId,phase,sourceRecordId,
        roundId:round.id,roundSha256,exportSha256:sha(Buffer.from(exportText,'utf8')),exportText,
        existingRecordIds,createdAt:new Date().toISOString(),destinationRecordId:null};
      state.copyIntents[key]=intent;
      // The original destination intent is durable before the UI can create its new store ID.
      await persist(phase);
    }
    need(intent.schema==='stellar-forge.grant-review-browser-copy-intent.v1'&&intent.key===key&&intent.operationId===operationId&&
      intent.phase===phase&&intent.sourceRecordId===sourceRecordId&&intent.roundId===round.id&&intent.roundSha256===roundSha256&&
      sha(Buffer.from(intent.exportText,'utf8'))===intent.exportSha256&&same(await importReviewRound(intent.exportText),round)&&
      Array.isArray(intent.existingRecordIds)&&new Set(intent.existingRecordIds).size===intent.existingRecordIds.length,
      'Resume the exact original full browser-copy intent.');
    const inspect=async()=>page.evaluate(async ({intent,round})=>{
      const store=await import('./drafts.mjs');
      if(intent.destinationRecordId){const selected=await store.loadDraft(intent.destinationRecordId);return selected?[selected]:[];}
      const found=[];
      for(const meta of await store.listDrafts())if(!intent.existingRecordIds.includes(meta.id)&&meta.name===round.folder){
        const row=await store.loadDraft(meta.id);
        if(row?.input?.schema===round.schema&&row.input.id===round.id&&JSON.stringify(row.input)===JSON.stringify(round))found.push(row);
      }
      return found;
    },{intent:{destinationRecordId:intent.destinationRecordId,existingRecordIds:intent.existingRecordIds},round});
    let candidates=await inspect();
    need(candidates.length<=1,'Reconcile the original selected browser copy; multiple matching new records exist.');
    if(intent.destinationRecordId)need(candidates.length===1,'Keep the original saved browser-copy destination; it is no longer available.');
    if(!candidates.length){
      await upload(page.locator('#review-open-round'),intent.exportText,'selected-complete-review.json');
      await page.locator('#review-save-copy').click();await idle();
      const id=await page.locator('#review-workspace').getAttribute('data-review-record-id');
      need(id&&!intent.existingRecordIds.includes(id)&&id!==sourceRecordId,'The original UI must create a separate browser record.');
      const saved=await page.evaluate(async id=>{const store=await import('./drafts.mjs');return store.loadDraft(id);},id);
      candidates=saved?[saved]:[];
    }
    const saved=candidates[0];
    need(saved?.id&&!intent.existingRecordIds.includes(saved.id)&&saved.id!==sourceRecordId&&same(saved.input,round),
      'The selected new browser record must retain the exact complete original round.');
    intent.destinationRecordId=saved.id;intent.browserRevision=saved.revision;
    await persist(phase);
    const selectedUrl=new URL('grant-review-round.html',base);selectedUrl.searchParams.set('review',saved.id);
    await page.goto(selectedUrl.href,{waitUntil:'networkidle',timeout:timeoutMs});await idle();
    return saved.id;
  }
  async function viewReceipt(name,width,height=980){
    const path='views/'+name+'-'+width+'.png',prior=state.artifacts.find(x=>x.path===path);
    if(prior){verifyFile(prior);return;}
    await page.setViewportSize({width,height});await idle();
    const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
      heading:document.querySelector('#review-editor h2')?.textContent,bodyText:document.body.innerText.length}));
    need(metrics.scroll<=metrics.width+1,'The actual review view overflows at '+width+' pixels.');
    const image=await page.screenshot({fullPage:true,type:'png'});put(file(path,image,'image/png'));state.views.push({name,...metrics,path});
  }
  try{
    // Check the actual served originals before interacting with any saved work.
    for(const selected of sourceFiles){
      need(typeof selected.route==='string'&&!selected.route.includes('..')&&!selected.route.includes('?')&&!selected.route.includes('#'),'Retain a selected application route.');
      const route=selected.route.replace(/^\//,''),url=new URL(route,base);
      need(url.origin===base.origin&&url.href.startsWith(base.href),'Retain the original application source root.');
      const response=await page.request.get(url.href);need(response.ok(),'The existing server did not serve '+route+' ('+response.status()+').');
      const body=await response.body();
      need(body.length===selected.bytes&&sha(body)===selected.sha256&&git(body)===selected.gitBlob,'The served full source differs from the selected '+route);
    }
    if(state.recoveredRoundExport){
      const retainedPhase=state.phase,recovered=await importReviewRound(state.recoveredRoundExport);
      need(recovered.id===state.roundId&&recovered.title===operationId,'Retain the same original unsaved browser review.');
      const retainedId=retainedPhase==='RECEIVING'?state.receivedRecordId:state.recordId;
      const recoveryUrl=new URL('grant-review-round.html',base);if(retainedId)recoveryUrl.searchParams.set('review',retainedId);
      await page.goto(recoveryUrl.href,{waitUntil:'networkidle',timeout:timeoutMs});await idle();
      const stored=retainedId?await page.evaluate(async id=>{const store=await import('./drafts.mjs');return store.loadDraft(id);},retainedId):null;
      if(!stored||!same(stored.input,recovered)){
        need(!stored||same(stored.input.events,recovered.events.slice(0,stored.input.events.length)),
          'Reconcile the concurrently changed original browser review before selecting its preserved unsaved result.');
        const recoveredId=await saveSelectedBrowserCopy({
          key:'recovered:'+sha(Buffer.from(JSON.stringify(recovered),'utf8')),round:recovered,exportText:state.recoveredRoundExport,
          phase:retainedPhase,sourceRecordId:retainedId||null});
        state.previousRecordIds=[...(state.previousRecordIds||[]),retainedId].filter(Boolean);
        state.recordId=recoveredId;
        if(retainedPhase==='RECEIVING')state.receivedRecordId=recoveredId;else state.originalRecordId=recoveredId;
      }
      state.recoveredRoundExport=null;await persist(retainedPhase);
    }
    if(!['UI_COMPLETE','RECEIVING'].includes(state.phase)){
      const url=new URL('grant-review-round.html',base);
      if(state.recordId)url.searchParams.set('review',state.recordId);
      await page.goto(url.href,{waitUntil:'networkidle',timeout:timeoutMs});await idle();
      if(!state.recordId){
        const found=await page.evaluate(async ({title,capture,reviewer})=>{
          const store=await import('./drafts.mjs'),result=[];
          for(const meta of await store.listDrafts())if(meta.name==='SCF review — '+title){
            const row=await store.loadDraft(meta.id);
            if(row?.input?.schema==='stellar-forge.grant-review-round.v1'&&row.input.title===title&&row.input.initialEdition===capture&&row.input.creator?.label===reviewer)result.push(row);
          }return result;
        },{title:operationId,capture:fixtures.firstCapture.id,reviewer:selection.reviewerLabel});
        need(found.length<=1,'Select the already-owned original browser record from the saved checkpoint; multiple complete copies exist.');
        if(found.length){state.recordId=found[0].id;state.roundId=found[0].input.id;const restored=new URL('grant-review-round.html',base);restored.searchParams.set('review',state.recordId);await page.goto(restored.href,{waitUntil:'networkidle',timeout:timeoutMs});await idle();}
        else{
          await upload(page.locator('#review-open-draft'),fixtures.firstCapture.exportText,'original-complete-submission.json');
          await page.locator('#review-new-title').fill(operationId);await page.locator('#review-new-person').fill(selection.reviewerLabel);
          await page.locator('#review-new-format').selectOption('plain');
          await page.getByRole('button',{name:'Start this review',exact:true}).click();await idle();
          state.recordId=await page.locator('#review-workspace').getAttribute('data-review-record-id');state.roundId=await page.locator('#review-workspace').getAttribute('data-review-id');
          need(state.recordId&&state.roundId,'The original browser did not retain its newly created complete review.');
        }
      }
      state.originalRecordId=state.originalRecordId||state.recordId;
      let saved=await current();
      need(saved.round.initialEdition===fixtures.firstCapture.id&&saved.round.creator.label===selection.reviewerLabel,'Keep the selected full draft and named original reviewer.');
      await persist('WORKING');
      const reviewTarget=async(key,step,decision='accepted')=>ensure('review',step,async()=>{
        await actor(selection.reviewerLabel);await target(key);await page.locator('#review-decision').selectOption(decision);
        await page.locator('#review-decision-note').fill(note(step));await page.locator('#review-decision-form button[type="submit"]').click();await idle();
      },event=>{need(event.input.target.kind+':'+event.input.target.id===key&&event.input.decision===decision&&event.input.editionId===fixtures.firstCapture.id,'Retain the exact original reviewed target and decision.');});
      await reviewTarget('answer:project','project-decision');
      await reviewTarget('field:'+fixtures.fieldId,'field-decision');
      await reviewTarget('answer:need','need-decision','changes-requested');
      const firstView=await reviewRoundView((await current()).round,{editionId:fixtures.firstCapture.id}),originalNeed=firstView.targets.find(x=>x.key==='answer:need');
      const change=await ensure('change','specific-change',async()=>{
        await actor(selection.reviewerLabel);await target('answer:need');await page.locator('#review-change-title').fill('Retain the complete author revision');
        await page.locator('#review-change-priority').selectOption('major');await page.locator('#review-change-quote').fill(originalNeed.text.slice(0,180));
        await page.locator('#review-change-note').fill(note('specific-change'));await page.locator('#review-change-form button[type="submit"]').click();await idle();
      },event=>need(event.input.quote===originalNeed.text.slice(0,180)&&event.input.editionId===fixtures.firstCapture.id,'Keep the exact selected quote and original draft.'));
      saved=await current();
      let authorRow=saved.view.participants.find(x=>x.label===selection.authorLabel);
      if(!authorRow){
        need(saved.view.status==='OPEN','Retain the selected author before finishing the review.');
        await page.getByText('Add a named participant',{exact:true}).click();await page.locator('#review-new-participant').fill(selection.authorLabel);
        await page.locator('#review-add-person').click();await idle();saved=await current();authorRow=saved.view.participants.find(x=>x.label===selection.authorLabel);
      }
      need(authorRow&&authorRow.id!==saved.round.creator.id,'Retain distinct original reviewer and author identities.');await persist('WORKING');
      await ensure('receive','author-revision',async()=>{
        await actor(selection.authorLabel);await tab('compare');
        await upload(page.getByRole('button',{name:'Open revised full draft',exact:true}),fixtures.editedCapture.exportText,'author-complete-submission.json');
        await page.getByRole('button',{name:'Carry all unchanged decisions forward',exact:true}).click();await idle();
        await page.locator('[data-comparison-target="answer:need"] summary').click();
        await viewReceipt('author-comparison',1440);await viewReceipt('author-comparison',390,900);await persist('WORKING');
        await page.locator('#review-receive-note').fill(note('author-revision'));await page.locator('#review-receive-form button[type="submit"]').click();await idle();
      },(event,value)=>{
        need(event.input.editionId===fixtures.editedCapture.id&&event.input.fromEdition===fixtures.firstCapture.id,'Retain the actual received author edition.');
        const decisions=value.view.decisionsHistory.filter(x=>x.editionId===fixtures.editedCapture.id&&x.carriedBy);
        need(decisions.length===2&&decisions.every(x=>x.actorId===value.round.creator.id&&x.carriedBy===authorRow.id),'Explicit carry must preserve both original reviewer and selecting author.');
      });
      await ensure('respond','author-response',async()=>{
        await actor(selection.authorLabel);await tab('changes');
        const form=page.locator('form[data-reply-for="'+change.id+'"]');
        await form.locator('..').locator('summary').click();await form.getByLabel('Author response',{exact:true}).selectOption('addressed');
        await form.getByLabel('Author explanation',{exact:true}).fill(note('author-response'));await form.locator('button[type="submit"]').click();await idle();
      },event=>need(event.input.changeId===change.id&&event.input.editionId===fixtures.editedCapture.id,'Reply to the original request against the selected author revision.'));
      await ensure('resolve','first-resolution',async()=>{
        await actor(selection.reviewerLabel);await tab('changes');const form=page.locator('form[data-resolve-for="'+change.id+'"]');
        await form.locator('..').locator('summary').click();await form.getByLabel('Reviewer resolution',{exact:true}).selectOption('resolved');
        await form.getByLabel('Reviewer’s reason',{exact:true}).fill(note('first-resolution'));await form.locator('button[type="submit"]').click();await idle();
      },event=>need(event.input.changeId===change.id&&event.input.status==='resolved','Retain the named reviewer resolution.'));
      await ensure('receive','new-source-revision',async()=>{
        await actor(selection.authorLabel);await tab('compare');
        await upload(page.getByRole('button',{name:'Open revised full draft',exact:true}),fixtures.latestCapture.exportText,'current-source-complete-submission.json');
        await page.locator('#review-receive-note').fill(note('new-source-revision'));await page.locator('#review-receive-form button[type="submit"]').click();await idle();
      },(event,value)=>{
        need(event.input.editionId===fixtures.latestCapture.id&&event.input.fromEdition===fixtures.editedCapture.id,'Retain the selected new source edition.');
        need(value.view.changes.find(x=>x.id===change.id)?.resolutions.some(x=>x.id===event.id+':reopen:'+change.id),'Changed source context must retain the original automatic request reopening.');
      });
      saved=await current();need(saved.view.draft.id===JSON.parse(fixtures.firstCapture.exportText).draft.id&&saved.view.draft.fields.some(x=>x.id===fixtures.fieldId),
        'The full browser journey changed an original draft or issuer-field identity.');
      await ensure('finish','return-to-author',async()=>{
        await actor(selection.reviewerLabel);await page.locator('#review-finish').click();await idle();
        await page.locator('#review-outcome').selectOption('return-changes');await page.locator('#review-finish-note').fill(note('return-to-author'));
        await page.locator('#review-finish-form button[type="submit"]').click();await idle();
      },event=>need(event.input.editionId===fixtures.latestCapture.id&&event.input.outcome==='return-changes','Retain the explicit editorial handover outcome.'));
      await tab('finish');await viewReceipt('handover',1440);await viewReceipt('handover',390,900);
      const full=await download(page.locator('#review-export'),'customer/complete-review.json','application/json');
      const exported=full.toString('utf8'),complete=await importReviewRound(exported);saved=await current();
      need(same(complete,saved.round),'The full UI export differs from the saved original review.');
      state.originalRoundExport=exported;state.originalRound=clone(complete);
      await download(page.locator('#review-report'),'customer/review-report.md','text/markdown;charset=utf-8');
      const original=await download(page.locator('#review-draft-export'),'customer/current-original-submission.json','application/json');
      need(original.equals(Buffer.from(fixtures.latestCapture.exportText,'utf8')),'The original native draft download changed its full bytes.');
      put(file('customer/original-actions.json',JSON.stringify({schema:'stellar-forge.grant-review-browser-actions.v1',operationId,roundId:complete.id,events:complete.events},null,2)+'\n','application/json'));
      state.phase='UI_COMPLETE';await persist('UI_COMPLETE');
    }
    // A retained complete UI result is selected before repeating any screenshot or export.
    const selected=await importReviewRound(state.originalRoundExport);
    need(same(selected,state.originalRound),'Retain the complete UI result before receiving a second browser copy.');
    if(!state.receivedRecordId){
      const originalUrl=new URL('grant-review-round.html',base);originalUrl.searchParams.set('review',state.originalRecordId);
      await page.goto(originalUrl.href,{waitUntil:'networkidle',timeout:timeoutMs});await idle();
      const before=await current();need(same(before.round,selected),'The original browser record advanced after its completed export; retain that new work and use its saved receiving checkpoint explicitly.');
      state.receivedRecordId=await saveSelectedBrowserCopy({key:'independent-receive',round:selected,exportText:state.originalRoundExport,
        phase:'UI_COMPLETE',sourceRecordId:state.originalRecordId});
      need(state.receivedRecordId!==state.originalRecordId,'Receive into a separate original-store record without replacing the earlier one.');
      state.recordId=state.receivedRecordId;await persist('RECEIVING');
    }
    const receivedUrl=new URL('grant-review-round.html',base);receivedUrl.searchParams.set('review',state.receivedRecordId);
    await page.goto(receivedUrl.href,{waitUntil:'networkidle',timeout:timeoutMs});await idle();
    state.recordId=state.receivedRecordId;state.phase='RECEIVING';let received=await current();
    const original=await page.evaluate(async id=>{const store=await import('./drafts.mjs');return store.loadDraft(id);},state.originalRecordId);
    need(same(original?.input,selected),'Keep the complete original browser record unchanged.');
    const reopenedEvent=received.round.events.find(x=>x.kind==='reopen'&&x.input.note===note('received-reopen'));
    if(!reopenedEvent){
      need(same(received.round,selected),'The independent saved browser receive changed original review/source identities.');
      if(!state.artifacts.some(x=>x.path==='customer/received-complete-review.json')){
        const receivedExport=await download(page.locator('#review-export'),'customer/received-complete-review.json','application/json');
        need(same(await importReviewRound(receivedExport.toString('utf8')),selected),'The independently reopened browser export changed the complete original round.');
      }
      await persist('RECEIVING');
    }
    await ensure('reopen','received-reopen',async()=>{
      await actor(selection.authorLabel);await page.locator('#review-finish').click();await idle();
      await page.locator('#review-reopen-note').fill(note('received-reopen'));await page.locator('#review-reopen-form button[type="submit"]').click();await idle();
    },(event,value)=>{need(value.round.events.length===selected.events.length+1&&same(value.round.events.slice(0,-1),selected.events)&&value.view.status==='OPEN','Reopen only the same full received round and retain its complete original event prefix.');});
    received=await current();
    if(!state.artifacts.some(x=>x.path==='customer/received-reopened-review.json')){
      const reopenedExport=await download(page.locator('#review-export'),'customer/received-reopened-review.json','application/json');
      need(same(await importReviewRound(reopenedExport.toString('utf8')),received.round),'Retain the exact reopened independent browser record.');
    }
    const savedView=await reviewRoundView(selected);
    need(savedView.editions.length===3&&savedView.status==='COMPLETE'&&savedView.completion.outcome==='return-changes','Retain the complete three-edition editorial return.');
    need(errors.length===0,'The actual application reported browser errors: '+JSON.stringify(errors));
    state.completedAt=new Date().toISOString();
    state.result={schema:'stellar-forge.grant-review-browser-receiving.v1',state:'COMPLETE',operationId,selectionSha256,
      completedAt:state.completedAt,baseUrl:base.href,roundId:selected.id,reviewRevision:selected.events.length,
      originalRecordId:state.originalRecordId,receivedRecordId:state.receivedRecordId,receivedReviewRevision:received.round.events.length,receivedReviewState:received.view.status,sourceFiles:clone(sourceFiles),
      originalDraftId:savedView.draft.id,fieldId:fixtures.fieldId,reviewers:savedView.participants,
      originalDraftExports:selection.originalExports,reviewSha256:sha(Buffer.from(state.originalRoundExport,'utf8')),
      fullAnswers:savedView.draft.answers.length,fullFields:savedView.draft.fields.length,originalEditions:savedView.editions.length,
      views:clone(state.views),browserErrors:[],files:state.artifacts.map(({content,...row})=>row)};
    await persist('COMPLETE');return {result:clone(state.result),checkpoint:state,artifacts:clone(state.artifacts)};
  }catch(error){
    // Read the still-owned original page before returning; do not close it or retry an unknown checkpoint write.
    try{
      if(await page.locator('#review-export').isEnabled()){
        const pending=observed(page.waitForEvent('download',{timeout:Math.min(timeoutMs,5000)}));
        await page.locator('#review-export').click();const selectedDownload=await pending,stream=await selectedDownload.createReadStream();
        if(stream){const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;need(size<=64*1024*1024+65536,'The retained recovery export exceeds its complete allowance.');chunks.push(chunk);}
          const complete=Buffer.concat(chunks).toString('utf8'),retained=await importReviewRound(complete);
          if(retained.id===state.roundId)state.recoveredRoundExport=complete;
        }
      }
    }catch(recoveryError){state.recoveryObservation={message:recoveryError.message};}
    try{state.unrecordedFormObservation=await page.locator('#review-editor form').evaluateAll(forms=>forms.map(form=>({id:form.id,dataset:{...form.dataset},fields:Array.from(form.querySelectorAll('input,textarea,select')).map(x=>({id:x.id,tag:x.tagName,value:x.value}))})));}catch{}
    error.receivingCheckpoint=clone(state);error.browserObservations=clone(errors);
    throw error;
  }finally{
    page.off('pageerror',onError);page.off('requestfailed',failedRequest);
  }
}
