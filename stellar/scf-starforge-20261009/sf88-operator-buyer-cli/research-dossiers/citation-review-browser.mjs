// MIT. One original browser operation over a seeded, retained Research dossier.
import {readFile,writeFile,mkdir,lstat,open,rename,unlink,link} from 'node:fs/promises';
import {resolve,join,isAbsolute,basename} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const SCHEMA='sf88-citation-review-browser-journey.v1';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const need=(condition,code,detail=code)=>{if(!condition)throw Object.assign(new Error(detail),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=()=>new Date().toISOString();
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const rows=value=>Array.isArray(value)?value:[];
async function existing(path){try{return await readFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomic(path,bytes){
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    await rename(temporary,path);
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function exact(path,bytes){
  const old=await existing(path);
  if(old){need(old.length===bytes.length&&sha(old)===sha(bytes),'CITATION_BROWSER_RETAINED_BYTES_CHANGED');return;}
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;
      const retained=await readFile(path);need(retained.length===bytes.length&&sha(retained)===sha(bytes),'CITATION_BROWSER_RETAINED_BYTES_CHANGED');}
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function timeout(promise,milliseconds,code){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Object.assign(new Error(code),{code})),milliseconds))]);}
  finally{clearTimeout(timer);}
}

/**
 * Parent owns the original native-operation lifetime and seeded dossier. This phase
 * acquires no provider data and only calls the supplied original loopback listener.
 * The Chromium profile is private runtime state; only returned artifacts travel.
 */
export async function runCitationReviewBrowser({url,dossierId,noticeId,runDirectory,playwrightModule,chromiumExecutable}){
  const connection=new URL(url),token=new URLSearchParams(connection.hash.slice(1)).get('token');
  need(connection.protocol==='http:'&&['127.0.0.1','[::1]'].includes(connection.hostname)&&
    !connection.username&&!connection.password&&/^[a-f0-9]{64}$/.test(token||''),'CITATION_BROWSER_LOOPBACK_SESSION_REQUIRED');
  need(typeof dossierId==='string'&&/^d_[A-Za-z0-9_-]+$/.test(dossierId)&&
    typeof noticeId==='string'&&/^cu_[a-f0-9]{64}$/.test(noticeId),'CITATION_BROWSER_ORIGINAL_SELECTION_REQUIRED');
  for(const path of [runDirectory,playwrightModule,chromiumExecutable])need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,
    'CITATION_BROWSER_ABSOLUTE_RUNTIME_REQUIRED');
  await mkdir(runDirectory,{recursive:true,mode:0o700});
  const directory=await lstat(runDirectory);need(directory.isDirectory()&&!directory.isSymbolicLink(),'CITATION_BROWSER_PRIVATE_DIRECTORY_REQUIRED');
  const statePath=join(runDirectory,'citation-browser-state.json'),prior=await existing(statePath);
  const state=prior?JSON.parse(prior.toString('utf8')):{schema:SCHEMA,dossierId,noticeId,createdAt:stamp(),stage:'PREPARED',attempts:[],artifacts:{}};
  need(state.schema===SCHEMA&&state.dossierId===dossierId&&state.noticeId===noticeId,'CITATION_BROWSER_ORIGINAL_OPERATION_CHANGED');
  const redact=value=>String(value).split(token).join('[session]');
  const save=async()=>{const bytes=encoded(state);need(!bytes.includes(Buffer.from(token)),'CITATION_BROWSER_SESSION_IN_ARTIFACT');await atomic(statePath,bytes);};
  state.preparedArtifacts??={};state.artifactAttempts??={};
  const recoverArtifact=async name=>{
    const data=await existing(join(runDirectory,name)),selected=state.artifacts[name]||state.preparedArtifacts[name];
    if(!data){need(!state.artifacts[name],'CITATION_BROWSER_RETAINED_ARTIFACT_MISSING');return null;}
    need(selected&&selected.filename===name&&data.length===selected.bytes&&sha(data)===selected.sha256,
      'CITATION_BROWSER_RETAINED_ARTIFACT_CHANGED');
    need(!data.includes(Buffer.from(token)),'CITATION_BROWSER_SESSION_IN_ARTIFACT');
    if(!state.artifacts[name]){state.artifacts[name]=selected;await save();}
    return data;
  };
  const retain=async(name,bytes)=>{
    need(/^[a-z0-9][a-z0-9._-]+$/.test(name)&&!name.includes('..'),'CITATION_BROWSER_ARTIFACT_NAME');
    const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),descriptor={filename:name,bytes:data.length,sha256:sha(data)};
    need(!data.includes(Buffer.from(token)),'CITATION_BROWSER_SESSION_IN_ARTIFACT');
    const retained=await recoverArtifact(name);
    if(retained)return state.artifacts[name];
    const prepared=state.preparedArtifacts[name];
    if(prepared&&!same(prepared,descriptor)){
      // The prior candidate was selected but never published. Keep that history;
      // the same private operation may produce a new candidate while the path is absent.
      (state.artifactAttempts[name]??=[]).push({...prepared,outcome:'UNPUBLISHED',observedAbsentAt:stamp()});
    }
    state.preparedArtifacts[name]=descriptor;await save();
    await exact(join(runDirectory,name),data);
    state.artifacts[name]=descriptor;await save();return descriptor;
  };
  const verifyArtifacts=async()=>{
    for(const descriptor of Object.values(state.artifacts)){const bytes=await readFile(join(runDirectory,descriptor.filename));
      need(bytes.length===descriptor.bytes&&sha(bytes)===descriptor.sha256,'CITATION_BROWSER_RETAINED_ARTIFACT_CHANGED');}
  };
  if(state.stage==='COMPLETE'){await verifyArtifacts();return {...state.result,nativeOutputs:Object.values(state.artifacts)};}
  state.attempts.push({startedAt:stamp(),stage:state.stage});const attempt=state.attempts.at(-1);
  if(state.routeError){attempt.previousRouteError=state.routeError;delete state.routeError;}await save();
  const origin=connection.origin,base='/api/dossiers/'+encodeURIComponent(dossierId);
  const api=async(path,{method='GET',body}={})=>{
    const target=new URL(path,origin);need(target.origin===origin&&target.pathname.startsWith('/api/'),'CITATION_BROWSER_LOCAL_ROUTE_REQUIRED');
    const response=await fetch(target,{method,redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+token,
      ...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const bytes=Buffer.from(await response.arrayBuffer());
    let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{}
    need(response.ok,value?.error||'CITATION_BROWSER_HTTP_'+response.status,redact(value?.message||value?.error||'Original local API returned '+response.status));
    return {response,bytes,value};
  };
  const detail=async revision=>(await api(base+'/citation-updates?'+new URLSearchParams({noticeId,...(revision===undefined?{}:{revision:String(revision)})}))).value;
  let context,page,routeJob=null;
  try{
    const initial=await detail();
    need(initial.schema==='sf88-citation-update-review.v1'&&initial.dossier.id===dossierId&&initial.detail.noticeId===noticeId,
      'CITATION_BROWSER_NOTICE_CHANGED');
    if(!state.selection){
      need(rows(initial.detail.noticeSources).length>0&&rows(initial.detail.evidence).some(value=>value.retained&&value.selected),
        'CITATION_BROWSER_RETAINED_SOURCE_REQUIRED');
      need(rows(initial.detail.findings).length>=2&&new Set(initial.detail.findings.map(value=>value.questionId)).size>=2,
        'CITATION_BROWSER_TWO_QUESTION_FINDINGS_REQUIRED');
      state.selection={noticeDoi:initial.detail.noticeDoi,targetDoi:initial.detail.targetDoi,type:initial.detail.type,
        sources:initial.detail.noticeSources.map(value=>({editionId:value.editionId,key:value.key,sourceSha256:value.sourceSha256,sourceBytes:value.sourceBytes}))};
      state.initialRevision=initial.dossier.revision;
      await retain('citation-browser-original-notice.json',encoded(initial));await save();
    }else{
      need(state.selection.noticeDoi===initial.detail.noticeDoi&&state.selection.targetDoi===initial.detail.targetDoi&&
        state.selection.type===initial.detail.type,'CITATION_BROWSER_NOTICE_CHANGED');
      for(const source of state.selection.sources)need(rows(initial.detail.noticeSources).some(value=>
        value.editionId===source.editionId&&value.key===source.key&&value.sourceSha256===source.sourceSha256&&value.sourceBytes===source.sourceBytes),
        'CITATION_BROWSER_RETAINED_SOURCE_CHANGED');
    }
    {
      const directory=fileURLToPath(new URL('.',import.meta.url)),names=['citation-review-browser.mjs','public/citation-review.js','public/citation-review.css','public/app.js','public/index.html'];
      const selected=[];
      for(const name of names){const bytes=await readFile(join(directory,name));selected.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}
      const fingerprint=sha(encoded(selected));state.sourceEditions??=[];
      if(state.sourceEditions.at(-1)?.fingerprint!==fingerprint)state.sourceEditions.push({fingerprint,selectedAt:stamp(),files:selected});
      state.sourcePins=selected;attempt.sourceFingerprint=fingerprint;await save();
    }
    const loaded=await import(pathToFileURL(playwrightModule).href),chromium=loaded.chromium||loaded.default?.chromium;
    need(chromium?.launchPersistentContext,'CITATION_BROWSER_PLAYWRIGHT_REQUIRED');
    context=await chromium.launchPersistentContext(join(runDirectory,'citation-browser-profile'),{
      executablePath:chromiumExecutable,headless:true,acceptDownloads:true,serviceWorkers:'block',
      viewport:{width:1440,height:1000},args:['--no-sandbox','--disable-dev-shm-usage','--disk-cache-size=1048576','--media-cache-size=1048576']
    });
    context.setDefaultTimeout(20000);
    const denied=[];
    await context.route('**/*',async route=>{
      try{
      const request=route.request(),target=new URL(request.url());
      if(target.origin!==origin){denied.push({method:request.method(),origin:target.origin,path:target.pathname});await route.abort('blockedbyclient');return;}
      if(request.method()==='POST'&&target.pathname===base+'/citation-updates/reviews'){
        const payload=request.postDataJSON();
        if(state.originalRequest)need(same(payload,state.originalRequest),'CITATION_BROWSER_REPLAY_INPUT_CHANGED');
        else{state.originalRequest=payload;need(payload.noticeId===noticeId,'CITATION_BROWSER_REVIEW_NOTICE_CHANGED');await save();}
        if(!state.lostReplyObserved&&!state.acceptedReview){
          routeJob=(async()=>{
            const response=await route.fetch({maxRedirects:0}),bytes=Buffer.from(await response.body());
            let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{}
            need(response.ok(),value?.error||'CITATION_BROWSER_REVIEW_FAILED',redact(value?.message||value?.error||'Original review save failed'));
            need(value.review?.requestId===payload.requestId&&value.review?.noticeId===noticeId,'CITATION_BROWSER_REVIEW_RECEIPT_CHANGED');
            await retain('citation-browser-first-accepted-response.json',bytes);
            state.acceptedReview={id:value.review.id,requestId:value.review.requestId,originalRevision:value.review.originalRevision,revision:value.review.revision};
            state.lostReplyObserved=true;state.stage='ORIGINAL_REPLY_RETAINED';await save();
            await route.abort('failed');
          })();
          await routeJob;
          return;
        }
      }
      await route.continue();
      }catch(cause){
        state.routeError={code:cause.code||'REVIEW_ROUTE_FAILED',message:redact(cause.message||cause)};
        await save().catch(()=>{});
        await route.abort('failed').catch(()=>{});
      }
    });
    page=context.pages()[0]||await context.newPage();
    page.on('dialog',dialog=>{(dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss()).catch(()=>{});});
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push({message:redact(error.message)}));
    const pageUrl=new URL('/',origin);pageUrl.hash=new URLSearchParams({token,dossier:dossierId,view:'citation-review'}).toString();
    const ready=async()=>{
      await page.locator('#citation-review-tab').waitFor({state:'visible'});
      await page.locator('#workspace[aria-busy="false"]').waitFor();
      if(!await page.locator('#view-citation-review').isVisible())await page.locator('#citation-review-tab').click();
      await page.locator('[data-notice-id="'+noticeId+'"]').waitFor({state:'visible'});
      await page.locator('[data-notice-id="'+noticeId+'"]').click();
      await page.locator('#citation-review-form').waitFor({state:'visible'});
      await page.locator('#citation-review-actor:not([disabled])').waitFor();
    };
    const reopen=async()=>{await page.goto(pageUrl.href,{waitUntil:'domcontentloaded'});await ready();};
    const download=async(action,name)=>{
      const [result]=await Promise.all([page.waitForEvent('download'),Promise.resolve().then(action)]);
      const failure=await result.failure();need(!failure,'CITATION_BROWSER_DOWNLOAD_FAILED',redact(failure||''));
      const path=await result.path();need(path,'CITATION_BROWSER_DOWNLOAD_MISSING');
      const bytes=await readFile(path);if(name){await retain(name,bytes);return await recoverArtifact(name);}return bytes;
    };
    const downloadDraft=async name=>JSON.parse((await download(()=>page.getByRole('button',{name:'Download draft',exact:true}).click(),name)).toString('utf8')).draft;
    const draftLineage=async(id,target)=>page.evaluate(async({id,target})=>{
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('research-citation-review-browser-v1',1);
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      try{
        const chain=[];let current=id;
        for(let depth=0;current&&depth<64;depth++){
          const value=await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readonly'),request=tx.objectStore('drafts').get(current);
            request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
          if(!value)return {reached:false,chain};
          chain.push({id:value.id,derivedFrom:value.derivedFrom||null,dossierId:value.dossierId,noticeId:value.noticeId,
            baseRevision:value.baseRevision,baseFingerprint:value.baseFingerprint});
          if(value.id===target)return {reached:true,chain};
          current=value.derivedFrom;
        }
        return {reached:false,chain};
      }finally{db.close();}
    },{id,target});
    const editor=()=>page.locator('#citation-notice-detail');
    const finding=id=>editor().locator('[data-finding-id="'+id+'"]');
    await reopen();

    const findSavedReview=async()=>{
      const current=await detail();
      const review=state.originalRequest?rows(current.detail.reviews).find(item=>item.requestId===state.originalRequest.requestId):null;
      if(review){
        need(review.noticeId===noticeId&&review.originalRevision===state.originalRequest.expectedRevision,'CITATION_BROWSER_REVIEW_IDENTITY_CHANGED');
        state.acceptedReview={id:review.id,requestId:review.requestId,originalRevision:review.originalRevision,revision:review.revision};
        await save();
      }
      return {current,review};
    };
    let saved=await findSavedReview();
    if(!state.originalRequest&&!saved.review){
      if(!state.artifacts['citation-browser-original-edition.json']){
        await editor().locator('.cr-source-section > summary').click();
        await editor().getByRole('button',{name:'Inspect original record',exact:true}).first().click();
        await editor().getByRole('button',{name:'Download original result record',exact:true}).first().waitFor({state:'visible'});
        const record=await download(()=>editor().getByRole('button',{name:'Download original result record',exact:true}).first().click(),
          'citation-browser-original-record.json');
        need(record.length>0&&typeof JSON.parse(record.toString('utf8'))==='object','CITATION_BROWSER_ORIGINAL_RECORD_REQUIRED');
        const edition=await download(()=>editor().getByRole('button',{name:'Download original edition',exact:true}).first().click(),
          'citation-browser-original-edition.json');
        need(state.selection.sources.some(source=>source.sourceBytes===edition.length&&source.sourceSha256===sha(edition)),
          'CITATION_BROWSER_ORIGINAL_EDITION_CHANGED');
        state.stage='ORIGINAL_SOURCE_OPENED';await save();
      }
      if(!state.draftPlan){
        const source=saved.current.detail;
        const annotation='Citation review: the retained metadata registers a '+source.type+' notice ('+source.noticeDoi+
          ') for '+source.targetDoi+'. This finding records that source update and retains the original edition for review.';
        state.draftPlan={actor:'Research dossier operator',decision:'revise',annotation,
          reason:'Reviewed the original registered '+source.type+' notice '+source.noticeDoi+' for '+source.targetDoi+
            '. The complete evidence notes and source-review findings below record the explicit changes.',
          evidence:source.evidence.map(item=>({occurrenceId:item.occurrenceId,selected:item.selected,
            classification:'background',note:(item.note?item.note+'\n\n':'')+annotation})),
          findings:source.findings.map(item=>{
            const noticeCitation=rows(source.citationOptions).find(option=>option.questionId===item.questionId&&option.doi===source.noticeDoi);
            return {id:item.id,title:item.title,text:item.text+'\n\n'+annotation,originalText:item.text,
              occurrenceIds:[...new Set([...item.occurrenceIds,...(noticeCitation?[noticeCitation.occurrenceId]:[])])],
              disposition:'revised',dispositionReason:'Updated the complete source-review text'+(noticeCitation?' and attached the original notice citation':'')+
                ' while preserving the retained source history.'};
          })};
        await save();
      }
      const plan=state.draftPlan;
      const fillDraft=async()=>{
        await page.locator('#citation-review-actor').fill(plan.actor);
        await page.locator('#citation-review-decision').selectOption(plan.decision);
        await page.locator('#citation-review-reason').fill(plan.reason);
        for(const item of plan.evidence){
          const row=editor().locator('[data-evidence-id="'+item.occurrenceId+'"]');
          await row.getByLabel('Include this occurrence in selected evidence',{exact:true}).setChecked(item.selected);
          await row.getByLabel('Evidence classification',{exact:true}).selectOption(item.classification);
          await row.getByLabel('Evidence note',{exact:true}).fill(item.note);
        }
        for(const item of plan.findings){
          const row=finding(item.id);
          await row.getByLabel('Finding title',{exact:true}).fill(item.title);
          await row.getByLabel('Full finding text',{exact:true}).fill(item.text);
          const boxes=row.locator('input[data-occurrence-id]');
          for(let index=0;index<await boxes.count();index++){
            const input=boxes.nth(index),id=await input.getAttribute('data-occurrence-id');
            await input.setChecked(item.occurrenceIds.includes(id));
          }
          await row.locator('[data-finding-disposition]').selectOption(item.disposition);
          await row.locator('[data-finding-reason]').fill(item.dispositionReason);
        }
      };
      const verifyDraft=async()=>{
        need(await page.locator('#citation-review-actor').inputValue()===plan.actor&&
          await page.locator('#citation-review-decision').inputValue()===plan.decision&&
          await page.locator('#citation-review-reason').inputValue()===plan.reason,'CITATION_BROWSER_DRAFT_RECOVERY_FAILED');
        for(const item of plan.findings){
          const row=finding(item.id);
          need(await row.getByLabel('Finding title',{exact:true}).inputValue()===item.title&&
            await row.getByLabel('Full finding text',{exact:true}).inputValue()===item.text&&
            await row.locator('[data-finding-disposition]').inputValue()===item.disposition&&
            await row.locator('[data-finding-reason]').inputValue()===item.dispositionReason,'CITATION_BROWSER_FINDING_DRAFT_RECOVERY_FAILED');
          const selected=await row.locator('input[data-occurrence-id]:checked').evaluateAll(nodes=>nodes.map(node=>node.dataset.occurrenceId).sort());
          need(same(selected,[...item.occurrenceIds].sort()),'CITATION_BROWSER_CITATION_DRAFT_RECOVERY_FAILED');
        }
        for(const item of plan.evidence){
          const row=editor().locator('[data-evidence-id="'+item.occurrenceId+'"]');
          need(await row.getByLabel('Evidence note',{exact:true}).inputValue()===item.note&&
            await row.getByLabel('Evidence classification',{exact:true}).inputValue()===item.classification,
            'CITATION_BROWSER_EVIDENCE_DRAFT_RECOVERY_FAILED');
        }
      };
      if(!state.draftRecovered){
        let draft;
        const retained=await existing(join(runDirectory,'citation-browser-draft-before-reload.json'));
        if(retained){draft=JSON.parse(retained.toString('utf8')).draft;await retain('citation-browser-draft-before-reload.json',retained);}
        else{await fillDraft();draft=await downloadDraft('citation-browser-draft-before-reload.json');}
        need(draft.dossierId===dossierId&&draft.noticeId===noticeId&&draft.baseRevision===state.initialRevision&&
          draft.findings[plan.findings[0].id].text===plan.findings[0].text,'CITATION_BROWSER_FULL_DRAFT_DOWNLOAD_CHANGED');
        state.draftBeforeReload={id:draft.id,baseRevision:draft.baseRevision,editVersion:draft.editVersion};
        await save();await page.reload({waitUntil:'domcontentloaded'});await ready();await verifyDraft();
        state.draftRecovered=true;state.stage='DRAFT_REOPENED';await save();
      }
      if(!state.concurrentEdit){
        const original=await detail();
        const selected=original.detail.findings.find(item=>item.id===plan.findings[0].id);
        need(selected,'CITATION_BROWSER_ORIGINAL_FINDING_MISSING');
        state.concurrentEdit={findingId:selected.id,expectedRevision:original.dossier.revision,
          title:selected.title,text:selected.text+'\n\nConcurrent source check: keep the original registered notice available with this finding.',
          beforeText:selected.text,state:'PREPARED'};
        await save();
      }
      if(state.concurrentEdit.state!=='COMPLETE'){
        const edit=state.concurrentEdit,current=await detail();
        const wantedRevision=edit.expectedRevision+1;
        if(current.dossier.revision===edit.expectedRevision){
          const response=await api(base+'/findings/'+encodeURIComponent(edit.findingId),{method:'POST',
            body:{expectedRevision:edit.expectedRevision,title:edit.title,text:edit.text}});
          need(response.value.revision===wantedRevision,'CITATION_BROWSER_CONCURRENT_REVISION_CHANGED');
          await retain('citation-browser-concurrent-edit-response.json',response.bytes);
        }
        const reopened=await detail(wantedRevision),finding=reopened.detail.findings.find(item=>item.id===edit.findingId);
        need(reopened.dossier.revision===wantedRevision&&finding?.text===edit.text&&finding?.title===edit.title,
          'CITATION_BROWSER_CONCURRENT_EDIT_RECONCILIATION');
        edit.state='COMPLETE';edit.revision=wantedRevision;await save();
      }
      if(!state.rebased){
        const retained=await existing(join(runDirectory,'citation-browser-draft-after-rebase.json'));
        if(retained){
          const draft=JSON.parse(retained.toString('utf8')).draft;
          const first=plan.findings.find(item=>item.id===state.concurrentEdit.findingId);
          const combined=state.concurrentEdit.text+'\n\n'+plan.annotation;
          need(draft.dossierId===dossierId&&draft.noticeId===noticeId&&draft.baseRevision===state.concurrentEdit.revision&&
            draft.actor===plan.actor&&draft.reason===plan.reason&&draft.findings[first.id].text===combined,
            'CITATION_BROWSER_RETAINED_REBASE_CHANGED');
          first.text=combined;await retain('citation-browser-draft-after-rebase.json',retained);
          state.rebased={draftId:draft.id,revision:draft.baseRevision,conflicts:state.rebaseConflictCount};
          state.stage='DRAFT_REBASED';await save();await page.reload({waitUntil:'domcontentloaded'});await ready();await verifyDraft();
        }
      }
      if(!state.rebased){
        // A browser may have committed the resolved draft before this outer journal
        // received its download. Reopen that actual draft and its original lineage.
        const opened=await downloadDraft();
        if(opened.baseRevision===state.concurrentEdit.revision){
          const current=await detail(state.concurrentEdit.revision);
          const lineage=await draftLineage(opened.id,state.draftBeforeReload.id);
          need(opened.dossierId===dossierId&&opened.noticeId===noticeId&&
            opened.baseFingerprint===current.detail.fingerprint&&lineage.reached&&
            lineage.chain.every(item=>item.dossierId===dossierId&&item.noticeId===noticeId),
            'CITATION_BROWSER_REBASED_DRAFT_LINEAGE_CHANGED');
          need(opened.actor===plan.actor&&opened.decision===plan.decision&&opened.reason===plan.reason,
            'CITATION_BROWSER_REBASED_DRAFT_FIELDS_CHANGED');
          const first=plan.findings.find(item=>item.id===state.concurrentEdit.findingId),combined=state.concurrentEdit.text+'\n\n'+plan.annotation;
          for(const item of plan.findings){
            const actual=opened.findings[item.id];
            need(actual&&actual.title===item.title&&same([...actual.occurrenceIds].sort(),[...item.occurrenceIds].sort())&&
              actual.disposition===item.disposition&&actual.dispositionReason===item.dispositionReason&&
              (actual.text===item.text||item.id===first.id&&actual.text===combined),'CITATION_BROWSER_REBASED_DRAFT_FIELDS_CHANGED');
          }
          for(const item of plan.evidence)need(same(opened.evidence[item.occurrenceId],{
            selected:item.selected,classification:item.classification,note:item.note}),'CITATION_BROWSER_REBASED_EVIDENCE_CHANGED');
          first.text=combined;await finding(first.id).getByLabel('Full finding text',{exact:true}).fill(combined);
          const complete=await downloadDraft('citation-browser-draft-after-rebase.json');
          state.rebased={draftId:complete.id,revision:complete.baseRevision,conflicts:state.rebaseConflictCount,
            recovery:'original-browser-draft',lineage:lineage.chain};
          state.stage='DRAFT_REBASED';await save();await verifyDraft();
        }
      }
      if(!state.rebased){
        await editor().getByRole('button',{name:'Download draft',exact:true}).waitFor({state:'visible'});
        await page.getByRole('button',{name:'Refresh current revision',exact:true}).click();
        await page.getByRole('button',{name:'Compare draft with current revision',exact:true}).waitFor({state:'visible'});
        await verifyDraft();
        await page.getByRole('button',{name:'Compare draft with current revision',exact:true}).click();
        const resolutions=page.locator('#citation-review-conflict select[data-rebase-conflict]');
        await resolutions.first().waitFor({state:'visible'});
        const count=await resolutions.count();need(count>=1,'CITATION_BROWSER_THREE_WAY_CONFLICT_REQUIRED');
        state.rebaseConflictCount=count;await save();
        for(let index=0;index<count;index++){
          const select=resolutions.nth(index),values=await select.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));
          await select.selectOption(values.includes('working')?'working':'retained');
        }
        await page.getByRole('button',{name:'Use resolved draft on revision '+state.concurrentEdit.revision,exact:true}).click();
        await page.locator('.cr-draft-status').filter({hasText:'revision '+state.concurrentEdit.revision}).waitFor();
        // Keep both the concurrent annotation and the explicit registered-notice review.
        const first=plan.findings.find(item=>item.id===state.concurrentEdit.findingId);
        first.text=state.concurrentEdit.text+'\n\n'+plan.annotation;
        await finding(first.id).getByLabel('Full finding text',{exact:true}).fill(first.text);
        const rebased=await downloadDraft('citation-browser-draft-after-rebase.json');
        need(rebased.baseRevision===state.concurrentEdit.revision&&rebased.findings[first.id].text===first.text,
          'CITATION_BROWSER_RESOLVED_DRAFT_CHANGED');
        state.rebased={draftId:rebased.id,revision:rebased.baseRevision,conflicts:count};
        state.stage='DRAFT_REBASED';await save();
        await page.reload({waitUntil:'domcontentloaded'});await ready();await verifyDraft();
      }
    }
    saved=await findSavedReview();
    if(!saved.review){
      if(!state.originalRequest){
        await page.locator('#citation-save-review:not([disabled])').waitFor();
        await page.locator('#citation-save-review').click();
      }else{
        const retry=page.getByRole('button',{name:'Retry original save',exact:true});
        await retry.first().waitFor({state:'visible'});await retry.first().click();
      }
      await page.getByRole('button',{name:'Retry original save',exact:true}).first().waitFor({state:'visible'});
      if(routeJob)await timeout(routeJob,30000,'CITATION_BROWSER_ORIGINAL_SAVE_PENDING');
      if(state.routeError)throw Object.assign(new Error(state.routeError.message),{code:state.routeError.code});
      saved=await findSavedReview();
      need(saved.review,'CITATION_BROWSER_ORIGINAL_SAVE_UNRECONCILED');
    }
    if(!state.browserRetry){
      await page.reload({waitUntil:'domcontentloaded'});await ready();
      const retry=page.getByRole('button',{name:'Retry original save',exact:true});
      if(await retry.count()){
        const observed=page.waitForResponse(value=>value.request().method()==='POST'&&new URL(value.url()).pathname===base+'/citation-updates/reviews')
          .then(async response=>({ok:response.ok(),bytes:Buffer.from(await response.body())}));
        const [response]=await Promise.all([observed,Promise.resolve().then(()=>retry.first().click())]);
        const value=JSON.parse(response.bytes.toString('utf8'));
        need(response.ok&&value.duplicate===true&&value.review?.id===saved.review.id&&
          value.review?.requestId===state.originalRequest.requestId,'CITATION_BROWSER_ORIGINAL_REQUEST_REPLAY_FAILED');
        await retain('citation-browser-recovered-response.json',response.bytes);
        state.browserRetry={mode:'original-browser-pending-request',duplicate:value.duplicate,requestId:value.review.requestId,reviewId:value.review.id};
      }else{
        // A completed browser receipt can survive a lost outer native result.
        const original=await api(base+'/citation-updates/reviews?projection=metadata',{method:'POST',body:state.originalRequest});
        need(original.value.duplicate===true&&original.value.review?.id===saved.review.id,'CITATION_BROWSER_RETAINED_REQUEST_REPLAY_FAILED');
        await retain('citation-browser-recovered-response.json',original.bytes);
        state.browserRetry={mode:'retained-original-native-request',duplicate:true,requestId:saved.review.requestId,reviewId:saved.review.id};
        await reopen();
      }
      state.stage='REVIEW_REOPENED';await save();
    }
    const reviewed=await detail();
    const review=rows(reviewed.detail.reviews).find(item=>item.requestId===state.originalRequest.requestId);
    need(review&&review.id===state.acceptedReview.id&&review.originalRevision===state.rebased.revision&&
      review.revision===review.originalRevision+1,'CITATION_BROWSER_ATOMIC_REVISION_CHANGED');
    need(review.findingDispositions.length===state.draftPlan.findings.length&&
      review.findingDispositions.every(item=>item.disposition==='revised'),'CITATION_BROWSER_FINDING_DISPOSITIONS_CHANGED');
    for(const item of state.draftPlan.findings){
      const final=reviewed.detail.findings.find(value=>value.id===item.id);
      need(final&&final.title===item.title&&final.text===item.text&&same([...final.occurrenceIds].sort(),[...item.occurrenceIds].sort()),
        'CITATION_BROWSER_REVIEWED_FINDING_CHANGED');
    }
    await page.locator('#workspace[aria-busy="false"]').waitFor();
    await editor().locator('.cr-history-row').filter({hasText:review.id}).waitFor({state:'visible'});
    const history=editor().locator('.cr-history-row').filter({hasText:review.id});
    if(!state.artifacts['citation-browser-before-report.html']){
      const previous=history.locator('.cr-report-row').filter({hasText:'Previous report · revision '+review.originalRevision});
      const bytes=await download(()=>previous.getByRole('button',{name:'HTML',exact:true}).click(),'citation-browser-before-report.html');
      need(bytes.includes(Buffer.from(state.selection.targetDoi)),'CITATION_BROWSER_PREVIOUS_REPORT_SOURCE_MISSING');
    }
    if(!state.artifacts['citation-browser-reviewed-report.md']){
      const after=history.locator('.cr-report-row').filter({hasText:'Reviewed report · revision '+review.revision});
      const bytes=await download(()=>after.getByRole('button',{name:'Markdown',exact:true}).click(),'citation-browser-reviewed-report.md');
      need(bytes.includes(Buffer.from(state.selection.noticeDoi))&&bytes.includes(Buffer.from(review.id)),
        'CITATION_BROWSER_REVIEWED_REPORT_HISTORY_MISSING');
    }
    if(!state.artifacts['citation-browser-reviewed-dossier.json.gz']){
      const after=history.locator('.cr-report-row').filter({hasText:'Reviewed report · revision '+review.revision});
      const bytes=await download(()=>after.getByRole('button',{name:'Portable dossier',exact:true}).click(),'citation-browser-reviewed-dossier.json.gz');
      need(bytes[0]===0x1f&&bytes[1]===0x8b,'CITATION_BROWSER_PORTABLE_DOSSIER_REQUIRED');
    }
    await retain('citation-browser-completed-review.json',encoded(review));
    await retain('citation-browser-final-notice.json',encoded(reviewed));
    const screens=[];
    for(const width of [1440,390,320]){
      const name='citation-browser-'+width+'.png';
      if(!await recoverArtifact(name)){
        await page.setViewportSize({width,height:width===1440?1000:900});
        await page.locator('#citation-review-tab').scrollIntoViewIfNeeded();
        await editor().locator('.cr-detail-heading').scrollIntoViewIfNeeded();
        const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
        need(dimensions.document<=dimensions.viewport+1,'CITATION_BROWSER_HORIZONTAL_OVERFLOW',JSON.stringify(dimensions));
        await retain(name,await page.screenshot({fullPage:false,animations:'disabled'}));
      }
      screens.push(state.artifacts[name]);
    }
    need(!pageErrors.length,'CITATION_BROWSER_PAGE_ERRORS',JSON.stringify(pageErrors));
    need(!denied.length,'CITATION_BROWSER_UNEXPECTED_EXTERNAL_REQUEST',JSON.stringify(denied));
    const latest=await detail();
    state.result={schema:SCHEMA,dossierId,noticeId,reviewId:review.id,requestId:review.requestId,
      initialRevision:state.initialRevision,originalRevision:review.originalRevision,reviewedRevision:review.revision,currentRevision:latest.dossier.revision,
      noticeDoi:state.selection.noticeDoi,targetDoi:state.selection.targetDoi,affectedFindings:state.draftPlan.findings.length,
      draftReload:true,threeWayRebase:state.rebased,originalSaveRecovery:state.browserRetry,sourcePins:state.sourcePins,sourceEditions:state.sourceEditions,
      screenshots:screens,completedAt:stamp()};
    await context.close();context=null;
    state.stage='COMPLETE';attempt.endedAt=stamp();attempt.outcome='COMPLETE';await save();await verifyArtifacts();
    return {...state.result,nativeOutputs:Object.values(state.artifacts)};
  }catch(cause){
    attempt.endedAt=stamp();attempt.outcome='INTERRUPTED_OR_FAILED';
    state.lastError={code:cause.code||'CITATION_BROWSER_OPERATION_FAILED',message:redact(cause.message||cause)};
    await save().catch(()=>{});
    throw Object.assign(new Error(state.lastError.message),{code:state.lastError.code});
  }finally{
    if(routeJob)await routeJob.catch(()=>{});
    if(context)await context.close();
  }
}
