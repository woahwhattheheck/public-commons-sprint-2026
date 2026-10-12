// MIT. Operate the complete RIS review in the existing Research application.
// The owning native programme retains the listener, original inputs and final package.
import {mkdir,readFile,writeFile,rename,unlink,lstat} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';
import {canonical,sha,decodeBase64} from './schema.mjs';
import {need} from '../../node/store.mjs';

const SCHEMA='sf88-research-ris-browser-journey-v1';
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const same=(a,b)=>canonical(a)===canonical(b);
const now=()=>new Date().toISOString();
const requestCode=error=>error?.code??'RIS_BROWSER_OPERATION_FAILED';
async function existing(path){
  try{const stat=await lstat(path);need(stat.isFile()&&!stat.isSymbolicLink(),'RIS_BROWSER_REGULAR_FILE_REQUIRED');return await readFile(path);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function atomic(path,value){
  const temporary=path+'.pending-'+randomUUID();
  try{await writeFile(temporary,value,{flag:'wx',mode:0o600});await rename(temporary,path);}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function directory(path){
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'RIS_BROWSER_ABSOLUTE_DIRECTORY_REQUIRED');
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);need(info.isDirectory()&&!info.isSymbolicLink(),'RIS_BROWSER_DIRECTORY_REQUIRED');
  return path;
}
function originalConnection(url,dossierId){
  const parsed=new URL(url),token=new URLSearchParams(parsed.hash.slice(1)).get('token');
  need(parsed.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(parsed.hostname)&&
    parsed.port&&!parsed.username&&!parsed.password&&/^[a-f0-9]{64}$/.test(token??''),'RIS_BROWSER_ORIGINAL_LISTENER_REQUIRED');
  parsed.hash=new URLSearchParams({token,dossier:dossierId,view:'ris-sources'}).toString();
  return {url:parsed.href,origin:parsed.origin,token};
}
function exactDocuments(source,original){
  need(Array.isArray(source?.documents)&&source.documents.length===original.documents.length,'RIS_BROWSER_DOCUMENT_COUNT_CHANGED');
  for(let index=0;index<original.documents.length;index++){
    const current=source.documents[index],expected=original.documents[index];
    need(same(current,expected),'RIS_BROWSER_ORIGINAL_DOCUMENT_CHANGED');
    const raw=decodeBase64(current.bodyBase64);
    need(raw.length===current.bytes&&sha(raw)===current.sha256,'RIS_BROWSER_ORIGINAL_BYTES_CHANGED');
  }
}
function sourceInputMatches(draft,source){
  const expected=source.documents.map(({id,...row})=>row);
  need(draft?.sourceInput?.documents&&same(draft.sourceInput.documents,expected),'RIS_BROWSER_DRAFT_ORIGINAL_BYTES_CHANGED');
}
function labelFor(receipt){return 'Retained-source review · '+receipt.requestId;}
function recordSummary(draft){
  return {requestId:draft.requestId,editId:draft.editId,baseRevision:draft.baseRevision,
    source:structuredClone(draft.source),review:structuredClone(draft.review),
    documents:draft.sourceInput.documents.map(row=>({filename:row.filename,bytes:row.bytes,sha256:row.sha256}))};
}

/**
 * Uses one persistent Chromium profile and the already running original listener.
 * baselineSource is the complete canonical source object returned by the original
 * source export; baselineRequest is its accepted {source,review,expectedPlanSha256,
 * expectedRevision}; baselineReceipt is that original accepted receipt.
 *
 * The second edition reuses those exact documents. Its explicit review defers the
 * duplicate group and classifies the remaining bibliography as background.
 * The original question receives an actual concurrent notes revision before the
 * browser retries the same receiving request against its reviewed current base.
 */
export async function runRisSourcesBrowser({url,workspaceDirectory,runDirectory,dossierId,questionId,
  baselineSource,baselineRequest,baselineReceipt,playwrightModule,chromiumExecutable}={}){
  const connection=originalConnection(url,dossierId);
  need(/^d_[a-f0-9-]{36}$/.test(dossierId??'')&&/^q_[a-f0-9-]{36}$/.test(questionId??''),'RIS_BROWSER_DOSSIER_REQUIRED');
  need(baselineReceipt?.schema==='sf88-research-ris-receipt-v1'&&baselineReceipt.questionId===questionId&&
    baselineRequest?.review?.requestId===baselineReceipt.requestId&&baselineRequest.review.questionId===questionId&&
    same(baselineRequest.source,baselineReceipt.source)&&baselineRequest.expectedPlanSha256===baselineReceipt.planSha256,
    'RIS_BROWSER_BASELINE_BINDING_CHANGED');
  exactDocuments(baselineSource,baselineSource);
  await directory(runDirectory);
  const output=await directory(join(runDirectory,'browser'));
  const privateDirectory=await directory(join(runDirectory,'private'));
  const inspectionDirectory=await directory(join(privateDirectory,'ris-browser-inspection'));
  const profileDirectory=await directory(join(privateDirectory,'ris-browser-profile'));
  const preparedDirectory=await directory(join(privateDirectory,'ris-browser-prepared'));
  const journalPath=join(output,'journey.json');
  const selection={dossierId,questionId,baselineReceipt,baselineRequest,baselineSourceSha256:sha(bytes(baselineSource))};
  const selectionSha256=sha(canonical(selection));
  const retained=await existing(journalPath);
  const state=retained?JSON.parse(retained):{schema:SCHEMA,selection,createdAt:now(),phase:'OPENING',
    requestId:null,steps:{},artifacts:{},pageErrors:[],attempts:[]};
  need(state.schema===SCHEMA&&same(state.selection,selection),'RIS_BROWSER_ORIGINAL_SELECTION_CHANGED');
  const scrub=text=>String(text).split(connection.token).join('[session]');
  const save=async()=>{
    state.updatedAt=now();const data=bytes(state);
    need(!data.includes(Buffer.from(connection.token)),'RIS_BROWSER_SESSION_IN_OUTPUT');
    await atomic(journalPath,data);
  };
  const phase=async value=>{state.phase=value;await save();};
  const artifactName=name=>need(/^[a-z0-9][a-z0-9._-]*$/.test(name)&&!name.includes('..'),
    'RIS_BROWSER_ARTIFACT_NAME_INVALID');
  const removePrepared=async name=>{
    await unlink(join(preparedDirectory,name+'.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  };
  const verifyArtifact=async(name,validate=()=>{})=>{
    artifactName(name);
    const item=state.artifacts[name],path=join(output,name),retained=await existing(path);
    if(item){
      need(retained&&retained.length===item.bytes&&sha(retained)===item.sha256,'RIS_BROWSER_RETAINED_ARTIFACT_CHANGED');
      validate(retained);await removePrepared(name);return retained;
    }
    const preparedBytes=await existing(join(preparedDirectory,name+'.json'));
    if(!preparedBytes){
      need(!retained,'RIS_BROWSER_ARTIFACT_PREPARATION_REQUIRED');return null;
    }
    const prepared=JSON.parse(preparedBytes);
    need(prepared.schema==='sf88-research-ris-browser-prepared-artifact-v1'&&prepared.name===name&&
      prepared.selectionSha256===selectionSha256,'RIS_BROWSER_ARTIFACT_PREPARATION_CHANGED');
    need(Number.isSafeInteger(prepared.bytes)&&prepared.bytes>=0&&/^[a-f0-9]{64}$/.test(prepared.sha256??''),
      'RIS_BROWSER_ARTIFACT_PREPARATION_CHANGED');
    const data=decodeBase64(prepared.bodyBase64,{maximum:prepared.bytes,name:'RIS_BROWSER_ARTIFACT_PREPARATION_CHANGED'});
    need(data.length===prepared.bytes&&sha(data)===prepared.sha256,'RIS_BROWSER_ARTIFACT_PREPARATION_CHANGED');
    need(!data.includes(Buffer.from(connection.token)),'RIS_BROWSER_SESSION_IN_OUTPUT');
    validate(data);
    if(retained)need(retained.equals(data),'RIS_BROWSER_RETAINED_ARTIFACT_CHANGED');
    else await atomic(path,data);
    state.artifacts[name]={name,bytes:prepared.bytes,sha256:prepared.sha256};await save();
    await removePrepared(name);return data;
  };
  const retain=async(name,data,validate=()=>{})=>{
    artifactName(name);
    data=Buffer.isBuffer(data)?data:bytes(data);validate(data);
    need(!data.includes(Buffer.from(connection.token)),'RIS_BROWSER_SESSION_IN_OUTPUT');
    const prior=await verifyArtifact(name,validate);
    if(prior){need(prior.equals(data),'RIS_BROWSER_RETAINED_ARTIFACT_CHANGED');return state.artifacts[name];}
    // Save the complete original candidate and its descriptor in one atomic file
    // before publication. A restart finishes these bytes without another download.
    await atomic(join(preparedDirectory,name+'.json'),bytes({
      schema:'sf88-research-ris-browser-prepared-artifact-v1',selectionSha256,name,
      bytes:data.length,sha256:sha(data),bodyBase64:data.toString('base64')
    }));
    await verifyArtifact(name,validate);return state.artifacts[name];
  };
  const outputs=()=>Object.values(state.artifacts).map(item=>({...item,path:join(output,item.name)}));
  if(state.phase==='COMPLETE'){
    for(const name of Object.keys(state.artifacts))await verifyArtifact(name);
    return {...state.result,artifacts:outputs(),journalPath,reused:true};
  }
  const client=new ResearchWorkspaceClient({url,directory:workspaceDirectory});
  const ris=client.risSources();
  let context,page,routeTask=null;const pageErrors=[];
  try{
    const status=await client.status();
    need(!state.workspaceId||state.workspaceId===status.workspaceId,'RIS_BROWSER_WORKSPACE_CHANGED');
    state.workspaceId=status.workspaceId;await save();
    const acceptedBaseline=await ris.sources(dossierId,{requestId:baselineReceipt.requestId});
    need(acceptedBaseline.dossier.id===dossierId&&same(acceptedBaseline.receipt,baselineReceipt),'RIS_BROWSER_BASELINE_RECEIPT_CHANGED');
    const require=createRequire(import.meta.url);
    const browserLibrary=typeof playwrightModule==='string'?require(playwrightModule):playwrightModule;
    need(browserLibrary?.chromium&&typeof chromiumExecutable==='string'&&isAbsolute(chromiumExecutable),
      'RIS_BROWSER_INSTALLED_CHROMIUM_REQUIRED');
    context=await browserLibrary.chromium.launchPersistentContext(profileDirectory,{
      executablePath:chromiumExecutable,headless:true,acceptDownloads:true,
      viewport:{width:1440,height:1050},serviceWorkers:'block',
      args:['--no-sandbox','--disable-dev-shm-usage']
    });
    page=await context.newPage();page.setDefaultTimeout(45000);
    page.on('pageerror',error=>{const observed={observedAt:now(),message:scrub(error.message)};
      pageErrors.push(observed);state.pageErrors.push(observed);});
    const root=page.locator('#view-ris-sources');
    const idle=async()=>{
      await page.locator('#workspace[aria-busy="false"]').waitFor({state:'visible'});
      await root.waitFor({state:'visible'});
    };
    const click=async(name,scope=root)=>{
      await scope.getByRole('button',{name,exact:true}).click();await idle();
    };
    const stored=async(method,id)=>page.evaluate(async({workspaceId,dossierId,method,id})=>{
      const {createRisDraftStore}=await import('/ris-drafts.js');
      const store=createRisDraftStore(workspaceId,dossierId);
      if(!['listDrafts','listPending','readDraft','readPending'].includes(method))throw new Error('RIS_BROWSER_READ_METHOD_INVALID');
      return id===undefined?store[method]():store[method](id);
    },{workspaceId:state.workspaceId,dossierId,method,id});
    const flushed=async()=>{
      await root.locator('.ris-storage').filter({hasText:'Complete edits are saved in this browser.'}).waitFor({state:'visible'});
    };
    const navigate=async()=>{
      await page.goto(connection.url,{waitUntil:'domcontentloaded'});
      await page.locator('#ris-sources-tab').click();await idle();
      await root.getByRole('button',{name:'Refresh saved work',exact:true}).waitFor({state:'visible'});
      await click('Refresh saved work');
    };
    const capture=async name=>{
      await page.screenshot({path:join(inspectionDirectory,name),fullPage:true});
    };
    const download=async(name,action,validate=()=>{})=>{
      const old=await verifyArtifact(name,validate);
      if(old)return old;
      const [incoming]=await Promise.all([
        page.waitForEvent('download'),Promise.resolve().then(action)
      ]);
      const temporary=join(output,'.incoming-'+randomUUID());
      try{
        await incoming.saveAs(temporary);const data=await readFile(temporary);
        await retain(name,data,validate);return data;
      }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    };
    const descriptorCheck=expected=>data=>need(data.length===expected.bytes&&sha(data)===expected.sha256,'RIS_BROWSER_DOWNLOADED_SOURCE_CHANGED');
    const openEdition=async receipt=>{
      await click('Saved editions');await click('Refresh saved work');
      const article=root.locator('.ris-edition').filter({hasText:receipt.requestId});
      need(await article.count()===1,'RIS_BROWSER_ORIGINAL_EDITION_NOT_UNIQUE');
      await click('Open source and review',article);
      await root.locator('.ris-saved').waitFor({state:'visible'});
    };
    const exportEdition=async(prefix,receipt,expectedSource)=>{
      await openEdition(receipt);
      const panel=root.locator('.ris-saved');
      await download(prefix+'-edition.json',()=>click('Original reviewed edition',panel),descriptorCheck(receipt.edition));
      const sourceBytes=await download(prefix+'-source.json',()=>click('Original source declaration',panel),descriptorCheck(receipt.source));
      const source=JSON.parse(sourceBytes);
      exactDocuments(source,baselineSource);
      if(expectedSource)need(same(source,expectedSource),'RIS_BROWSER_SOURCE_EXPORT_CHANGED');
      const documents=panel.locator('.ris-document');
      need(await documents.count()===source.documents.length,'RIS_BROWSER_DOCUMENTS_INCOMPLETE');
      for(let index=0;index<source.documents.length;index++){
        await download(prefix+'-document-'+String(index+1).padStart(3,'0')+'.ris',
          ()=>click('Download original RIS file',documents.nth(index)),descriptorCheck(source.documents[index]));
      }
      await download(prefix+'-review.html',()=>click('Full review HTML',panel));
      await download(prefix+'-review.csv',()=>click('Review CSV',panel));
      await download(prefix+'-dossier.html',()=>click('Dossier r'+receipt.revision+' · html',panel));
      await download(prefix+'-dossier.json.gz',()=>click('Dossier r'+receipt.revision+' · json.gz',panel));
      const firstRecord=panel.locator('.ris-record').first();
      await click('Inspect complete original record',firstRecord);
      await root.locator('.ris-detail').getByText('Exact decoded original record text',{exact:true}).waitFor({state:'visible'});
      await click('Close original record');
      return source;
    };
    const originalReceipt=async()=>{
      if(!state.requestId)return null;
      try{
        const value=await ris.sources(dossierId,{requestId:state.requestId});
        need(value.dossier.id===dossierId&&value.receipt.requestId===state.requestId,'RIS_BROWSER_RECEIPT_BINDING_CHANGED');
        return value;
      }catch(error){if(error.code==='RIS_REQUEST_NOT_FOUND')return null;throw error;}
    };
    const openSelectedDraft=async()=>{
      await click('Prepare and review');await click('Refresh saved work');
      const pending=await stored('readPending',state.requestId);
      const draft=await stored('readDraft',state.requestId);
      if(pending){
        await click((pending.state==='COMPLETE'?'Received · ':'Pending · ')+pending.label,root.locator('.ris-shelf'));
        return {pending,draft};
      }
      if(draft){await click(draft.sourceInput.label,root.locator('.ris-shelf'));return {pending:null,draft};}
      const recovery=await verifyArtifact('complete-draft.json');
      need(recovery,'RIS_BROWSER_ORIGINAL_DRAFT_REQUIRED');
      await root.getByLabel('Open a complete saved draft for this dossier',{exact:true}).setInputFiles({
        name:'complete-draft.json',mimeType:'application/json',buffer:recovery});
      await root.getByRole('button',{name:'Use this reviewed recovery draft',exact:true}).waitFor({state:'visible'});
      await click('Use this reviewed recovery draft');await flushed();
      return {pending:await stored('readPending',state.requestId),draft:await stored('readDraft',state.requestId)};
    };
    await navigate();await phase('BASELINE_EXPORTS');
    await exportEdition('baseline',baselineReceipt,baselineSource);
    if(!state.requestId){
      const candidates=(await stored('listDrafts')).filter(row=>row.label===labelFor(baselineReceipt));
      need(candidates.length<=1,'RIS_BROWSER_MULTIPLE_ORIGINAL_DRAFTS');
      if(candidates.length)state.requestId=candidates[0].requestId;
      else{
        await openEdition(baselineReceipt);await click('Continue from retained files');
        await root.getByLabel('Edition label',{exact:true}).fill(labelFor(baselineReceipt));
        await root.getByLabel('Reviewer',{exact:true}).fill('Commons literature operations');
        await root.getByLabel('Dossier question',{exact:true}).selectOption(questionId);
        // Re-select the actual earlier edition after the question control, whose
        // normal change handler deliberately clears an earlier-question binding.
        await root.getByLabel('Earlier RIS edition for this question',{exact:true}).selectOption(baselineReceipt.editionId);
        await root.getByLabel('Earlier edition evidence selections',{exact:true}).selectOption('deselect');
        await flushed();
        const created=(await stored('listDrafts')).filter(row=>row.label===labelFor(baselineReceipt));
        need(created.length===1,'RIS_BROWSER_ORIGINAL_DRAFT_NOT_SAVED');
        state.requestId=created[0].requestId;
      }
      await save();
    }
    let received=await originalReceipt();
    if(!received){
      await phase('COMPLETE_DRAFT_REVIEW');
      let selected=await openSelectedDraft();
      if(!selected.pending&&!state.steps.reviewedDraft){
        let draft=await stored('readDraft',state.requestId);
        sourceInputMatches(draft,baselineSource);
        if(draft.sourceInput.label!==labelFor(baselineReceipt))await root.getByLabel('Edition label',{exact:true}).fill(labelFor(baselineReceipt));
        if(!draft.review.actor)await root.getByLabel('Reviewer',{exact:true}).fill('Commons literature operations');
        if(draft.review.questionId!==questionId)await root.getByLabel('Dossier question',{exact:true}).selectOption(questionId);
        if(draft.review.previous?.editionId!==baselineReceipt.editionId)
          await root.getByLabel('Earlier RIS edition for this question',{exact:true}).selectOption(baselineReceipt.editionId);
        if(draft.review.previous?.priorSelection!=='deselect')
          await root.getByLabel('Earlier edition evidence selections',{exact:true}).selectOption('deselect');
        await flushed();draft=await stored('readDraft',state.requestId);
        const prepareName=draft.source?'Refresh review':'Prepare original files';
        await click(prepareName);await flushed();
        draft=await stored('readDraft',state.requestId);
        const preview=await ris.preview(dossierId,{source:draft.source,review:draft.review,offset:0,limit:30});
        need(preview.groups.length>0&&preview.counts.records===preview.records.length,
          'RIS_BROWSER_RETAINED_THREE_DOCUMENT_REVIEW_REQUIRED');
        const duplicateIds=new Set(preview.groups.flatMap(group=>group.recordIds));
        const articles=root.locator('.ris-record');
        need(await articles.count()===preview.records.length,'RIS_BROWSER_RECORDS_INCOMPLETE');
        for(let index=0;index<preview.records.length;index++){
          const record=preview.records[index],article=articles.nth(index);
          await article.getByLabel('Select this original occurrence',{exact:true}).setChecked(!duplicateIds.has(record.recordId));
          await article.getByLabel('Evidence classification',{exact:true}).selectOption('background');
          await article.getByLabel('Full review note',{exact:true}).fill(duplicateIds.has(record.recordId)?
            'The original and explicitly labelled local copy share the same DOI. This group is deferred for the customer occurrence review; both complete original records remain available.':
            'Retained Crossref bibliography for source and workflow context. Full original author, DOI, date and journal fields remain available for the customer review.');
        }
        const duplicates=root.locator('.ris-duplicate');
        need(await duplicates.count()===preview.groups.length,'RIS_BROWSER_DUPLICATE_GROUPS_INCOMPLETE');
        for(let index=0;index<preview.groups.length;index++){
          await duplicates.nth(index).getByLabel('Decision',{exact:true}).selectOption('defer');
          await duplicates.nth(index).getByLabel('Reason',{exact:true}).fill(
            'Both occurrences are retained with their original bytes and provenance. Defer the shared DOI group until the customer chooses its preferred retained occurrence.');
        }
        await click('Refresh review');await flushed();
        draft=await stored('readDraft',state.requestId);sourceInputMatches(draft,baselineSource);
        const reviewed=await ris.preview(dossierId,{source:draft.source,review:draft.review,offset:0,limit:30});
        need(reviewed.complete&&reviewed.counts.unresolvedIssues===0,'RIS_BROWSER_REVIEW_NOT_COMPLETE');
        state.steps.reviewedDraft=recordSummary(draft);state.steps.reviewedPlan=reviewed.planSha256;await save();
      }
      if(!selected.pending&&!state.steps.draftReload){
        await flushed();const before=await stored('readDraft',state.requestId);
        sourceInputMatches(before,baselineSource);
        await download('complete-draft.json',()=>click('Download complete draft'),data=>{
          const value=JSON.parse(data);need(value.requestId===before.requestId&&value.baseRevision===before.baseRevision&&
            same(value.sourceInput,before.sourceInput)&&same(value.source,before.source)&&same(value.review,before.review),
            'RIS_BROWSER_COMPLETE_DRAFT_DOWNLOAD_CHANGED');
        });
        await page.reload({waitUntil:'domcontentloaded'});await idle();
        await click('Refresh saved work');
        const after=await stored('readDraft',state.requestId);
        need(same(before,after),'RIS_BROWSER_RELOADED_DRAFT_CHANGED');
        state.steps.draftReload={requestId:state.requestId,editId:before.editId,
          bytes:bytes(before).length,sha256:sha(bytes(before)),observedAt:now()};await save();
      }
      if(!selected.pending&&!state.steps.recoveryFile){
        await openSelectedDraft();await flushed();
        const recovery=await verifyArtifact('complete-draft.json'),before=JSON.parse(recovery);
        await root.getByLabel('Open a complete saved draft for this dossier',{exact:true}).setInputFiles({
          name:'complete-draft.json',mimeType:'application/json',buffer:recovery});
        await root.getByRole('button',{name:'Use this reviewed recovery draft',exact:true}).waitFor({state:'visible'});
        await click('Use this reviewed recovery draft');await flushed();
        const restored=await stored('readDraft',state.requestId);
        need(restored.requestId===before.requestId&&same(restored.review,before.review)&&
          same(restored.sourceInput,before.sourceInput)&&same(restored.source,before.source),
          'RIS_BROWSER_RECOVERY_DRAFT_CHANGED');
        await click('Refresh review');await flushed();
        state.steps.recoveryFile={requestId:restored.requestId,editId:restored.editId,observedAt:now()};await save();
      }
      // The existing client is a real second operator on the same original
      // workspace. Its immutable revision makes an interrupted response readable.
      if(!state.steps.concurrentRevision){
        await phase('CONCURRENT_QUESTION_REVISION');
        const current=await client.metadata(dossierId);
        if(!state.concurrentRequest){
          const question=current.questions.find(row=>row.id===questionId);
          need(question,'RIS_BROWSER_QUESTION_NOT_FOUND');
          state.concurrentRequest={questionId,expectedRevision:current.revision,
            notes:(question.notes?question.notes+'\n\n':'')+'Retained-source review '+state.requestId+
              ': preserve the original Crossref RIS bytes and declared local copy while reviewing occurrence selections and bibliography provenance.'};
          await save();
        }
        const request=state.concurrentRequest,targetRevision=request.expectedRevision+1;
        let observed=current;
        if(current.revision===request.expectedRevision){
          try{observed=await client.updateQuestion(dossierId,questionId,{notes:request.notes,expectedRevision:request.expectedRevision});}
          catch(error){
            const recovered=await client.metadata(dossierId,{revision:targetRevision}).catch(()=>null);
            if(!recovered)throw error;observed=recovered;
          }
        }else observed=await client.metadata(dossierId,{revision:targetRevision});
        need(observed.revision===targetRevision&&observed.questions.find(row=>row.id===questionId)?.notes===request.notes,
          'RIS_BROWSER_CONCURRENT_REVISION_CHANGED');
        state.steps.concurrentRevision={revision:targetRevision,questionId,observedAt:now()};await save();
      }
      selected=await openSelectedDraft();
      let pending=selected.pending;
      if(!pending){
        const conflictResponse=page.waitForResponse(response=>{
          const target=new URL(response.url());return target.pathname.endsWith('/ris-sources/receive')&&
            response.request().method()==='POST'&&response.request().postDataJSON()?.review?.requestId===state.requestId;
        });
        const [response]=await Promise.all([
          conflictResponse,root.getByRole('button',{name:'Receive in one dossier revision',exact:true}).click()
        ]);await idle();
        const value=await response.json();
        need(response.status()===409&&value.error==='REVISION_CONFLICT','RIS_BROWSER_ACTUAL_REVISION_CONFLICT_REQUIRED');
        pending=await stored('readPending',state.requestId);
        need(pending?.state==='PENDING'&&pending.body.review.requestId===state.requestId,'RIS_BROWSER_CONFLICT_REQUEST_NOT_RETAINED');
        state.steps.revisionConflict={status:response.status(),error:value.error,requestId:state.requestId,
          expectedRevision:pending.body.expectedRevision,observedAt:now()};await save();
      }
      received=await originalReceipt();
      if(!received){
        // Reloading loses only the transient conflict message. Replaying the
        // exact old CAS after the original receipt lookup establishes the same
        // rejection and lets the operator review the actual current revision.
        const currentForReceive=await client.metadata(dossierId);
        if(pending.body.expectedRevision<currentForReceive.revision){
          if(!await root.getByRole('button',{name:'Review current dossier revision',exact:true}).count()){
            const rejected=page.waitForResponse(response=>response.request().method()==='POST'&&
              new URL(response.url()).pathname.endsWith('/ris-sources/receive')&&
              response.request().postDataJSON()?.review?.requestId===state.requestId);
            const [response]=await Promise.all([
              rejected,root.getByRole('button',{name:'Retry this same request',exact:true}).click()
            ]);await idle();
            need(response.status()===409&&(await response.json()).error==='REVISION_CONFLICT',
              'RIS_BROWSER_ACTUAL_REVISION_CONFLICT_REQUIRED');
          }
          await click('Review current dossier revision');
          const current=await client.metadata(dossierId);
          await click('Use reviewed revision '+current.revision);
          pending=await stored('readPending',state.requestId);
          need(pending.body.expectedRevision===current.revision&&pending.attempts?.length,
            'RIS_BROWSER_ORIGINAL_REBASE_NOT_RETAINED');
          state.steps.reviewedRebase={requestId:state.requestId,expectedRevision:pending.body.expectedRevision,
            attempts:pending.attempts,observedAt:now()};await save();
        }
        state.request=structuredClone(pending.body);await save();
        await retain('revised-original-request.json',pending.body);
        await phase('RECEIVING_WITH_RESPONSE_WITHHELD');
        const pattern='**/api/dossiers/*/ris-sources/receive*';
        const handler=async route=>{
          const incoming=route.request();
          if(incoming.method()!=='POST'||incoming.postDataJSON()?.review?.requestId!==state.requestId){
            await route.continue();return;
          }
          routeTask=(async()=>{
            need(same(incoming.postDataJSON(),state.request),'RIS_BROWSER_ORIGINAL_REQUEST_CHANGED');
            state.dispatch={requestId:state.requestId,expectedRevision:state.request.expectedRevision,startedAt:now()};
            await save();
            const response=await route.fetch({maxRedirects:0});
            const raw=Buffer.from(await response.body()),value=JSON.parse(raw);
            if(!response.ok()){await route.fulfill({response});throw Object.assign(new Error(value.error),{code:value.error});}
            need(value.dossier?.id===dossierId&&value.receipt?.requestId===state.requestId&&
              value.receipt.planSha256===state.request.expectedPlanSha256&&
              same(value.receipt.source,state.request.source),'RIS_BROWSER_ORIGINAL_RESPONSE_CHANGED');
            state.steps.originalReceive={status:response.status(),receipt:value.receipt,observedAt:now()};
            await save();
            await route.abort('failed');
            state.steps.withheldResponse={requestId:state.requestId,observedAt:now()};await save();
            return value;
          })();
          try{await routeTask;}catch(error){await route.abort('failed').catch(()=>{});}
        };
        await page.route(pattern,handler);
        try{
          const sent=page.waitForRequest(request=>request.method()==='POST'&&
            new URL(request.url()).pathname.endsWith('/ris-sources/receive')&&
            request.postDataJSON()?.review?.requestId===state.requestId);
          await Promise.all([
            sent,root.getByRole('button',{name:'Retry this same request',exact:true}).click()
          ]);
          await root.locator('.ris-status[data-kind="error"]').waitFor({state:'visible'});
          await idle();need(routeTask,'RIS_BROWSER_ORIGINAL_DISPATCH_NOT_OBSERVED');
          received=await routeTask;
        }finally{await page.unroute(pattern,handler);}
        pending=await stored('readPending',state.requestId);
        need(pending?.state==='PENDING'&&same(pending.body,state.request),'RIS_BROWSER_LOST_RESPONSE_REQUEST_CHANGED');
        state.steps.pendingAfterResponseLoss={requestId:pending.requestId,bodySha256:sha(canonical(pending.body)),observedAt:now()};
        await save();
      }
      await phase('ORIGINAL_RECEIPT_RECOVERY');
      // The page reload uses the same persistent profile and original request.
      await page.reload({waitUntil:'domcontentloaded'});await idle();await click('Refresh saved work');
      selected=await openSelectedDraft();
      if(selected.pending)await click('Check saved receipt');
      else if(selected.draft){
        const draft=await stored('readDraft',state.requestId);
        await click(draft.source?'Refresh review':'Prepare original files');
      }
      await idle();
      const recovered=await originalReceipt();
      need(recovered&&recovered.receipt.requestId===state.requestId,'RIS_BROWSER_ORIGINAL_RECEIPT_NOT_FOUND');
      if(state.steps.originalReceive)need(same(recovered.receipt,state.steps.originalReceive.receipt),'RIS_BROWSER_RECOVERED_RECEIPT_CHANGED');
      const completed=await stored('readPending',state.requestId);
      if(completed)need(completed.state==='COMPLETE'&&same(completed.receipt,recovered.receipt),'RIS_BROWSER_PENDING_NOT_COMPLETED');
      state.steps.recoveredReceipt={receipt:recovered.receipt,pendingState:completed?.state??null,observedAt:now()};
      received=recovered;await save();
    }else{
      // An interrupted native caller may return after the server already saved
      // the edition. Recover that original receipt before any further UI write.
      const pending=await stored('readPending',state.requestId);
      if(pending){
        await openSelectedDraft();await click('Check saved receipt');
        const completed=await stored('readPending',state.requestId);
        need(completed?.state==='COMPLETE'&&same(completed.receipt,received.receipt),'RIS_BROWSER_PENDING_NOT_COMPLETED');
        state.steps.recoveredReceipt={receipt:received.receipt,pendingState:completed.state,observedAt:now()};await save();
      }
    }
    const receipt=received.receipt;
    need(receipt.previous?.editionId===baselineReceipt.editionId&&receipt.previous?.priorSelection==='deselect',
      'RIS_BROWSER_PRIOR_SELECTION_CHANGED');
    await retain('revised-receipt.json',receipt);
    await phase('REVISED_SOURCE_AND_REPORT_EXPORTS');
    await exportEdition('revised',receipt);
    await capture('review-desktop.png');
    await page.setViewportSize({width:390,height:844});
    await capture('review-narrow.png');
    const layout=await root.evaluate(element=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
      panelWidth:Math.round(element.getBoundingClientRect().width)}));
    state.steps.narrowView={...layout,horizontalOverflow:layout.documentWidth>layout.viewport,observedAt:now()};await save();
    await page.setViewportSize({width:1440,height:1050});
    await click('Compare editions');
    await root.getByLabel('Earlier edition',{exact:true}).selectOption(baselineReceipt.editionId);
    await root.getByLabel('Later edition',{exact:true}).selectOption(receipt.editionId);
    await click('Compare retained editions');
    const comparison=JSON.parse(await download('source-comparison.json',()=>click('Complete comparison · json')));
    need(comparison.beforeReceipt?.editionId===baselineReceipt.editionId&&comparison.afterReceipt?.editionId===receipt.editionId,
      'RIS_BROWSER_COMPARISON_BINDING_CHANGED');
    await download('source-comparison.html',()=>click('Complete comparison · html'));
    await download('source-comparison.md',()=>click('Complete comparison · md'));
    await capture('comparison-desktop.png');
    const current=await client.metadata(dossierId),sameRequest=await ris.sources(dossierId,{requestId:state.requestId});
    need(same(sameRequest.receipt,receipt)&&sameRequest.dossier.revision===current.revision,'RIS_BROWSER_FINAL_RECEIPT_CHANGED');
    need(pageErrors.length===0,'RIS_BROWSER_APPLICATION_ERROR');
    state.result={schema:SCHEMA,workspaceId:state.workspaceId,dossierId,questionId,
      request:state.request??null,receipt,beforeRevision:baselineReceipt.revision,afterRevision:receipt.revision,
      currentRevision:current.revision,baselineReceipt,comparison:comparison.counts,
      steps:state.steps,inspectionDirectory};
    await phase('COMPLETE');
    return {...state.result,artifacts:outputs(),journalPath,reused:false};
  }catch(error){
    if(routeTask)await routeTask.catch(()=>{});
    state.attempts.push({endedAt:now(),phase:state.phase,code:requestCode(error),message:scrub(error.message)});
    await save().catch(()=>{});throw error;
  }finally{
    try{if(context)await context.close();}finally{await client.close();}
  }
}
