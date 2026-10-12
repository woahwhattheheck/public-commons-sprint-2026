// MIT. Resume the original native-plan delivery on the existing grant receiving Page.
import {mkdir,open,link,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {ENVELOPE,restoreVersion} from './dist/grant-submission-core.mjs';
import {planSummary} from './dist/grant-plan-core.mjs';
import {verifyHandover} from './dist/grant-handover-source.mjs';
import {SUBMISSION_ROUTES} from './grant-submission.mjs';

const OPERATION='SCF-PLAN-SUBMISSION-INTEGRATION-7F5A-20261012';
const SCHEMA='stellar-forge.grant-planning-receiving.v2';
const MAXIMUM=34*1024*1024;
const activePages=new WeakSet(),activeOutputs=new Set();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,message)=>{if(!value)throw Error(message);};
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const canonical=value=>JSON.stringify(sort(value));
function sort(value){
  if(Array.isArray(value))return value.map(sort);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])]));
  return value;
}
function stateHash(draft){
  const {versions,updatedAt,...state}=draft;
  return sha(canonical(state));
}
async function ordinary(path,maximum=MAXIMUM){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await file.stat();
    need(before.isFile()&&before.size<=maximum,'Select a complete ordinary file: '+path);
    const bytes=await file.readFile(),after=await file.stat();
    need(bytes.length===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs,
      'The selected file changed: '+path);
    return bytes;
  }finally{await file.close();}
}
async function optional(path){
  try{return await ordinary(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function publish(path,bytes,{replace=false}={}){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const existing=await optional(path);
  if(existing&&!replace){need(existing.equals(bytes),'Retain the existing different delivery: '+path);return;}
  if(existing?.equals(bytes))return;
  const temporary=path+'.pending-'+randomUUID();
  const file=await open(temporary,'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  try{
    if(replace)await rename(temporary,path);
    else try{await link(temporary,path);}
      catch(error){if(error.code!=='EEXIST')throw error;need((await ordinary(path)).equals(bytes),'Retain the concurrent original delivery: '+path);}
    const directory=await open(dirname(path),constants.O_RDONLY);
    try{await directory.sync();}finally{await directory.close();}
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function envelope(bytes){
  const value=JSON.parse(bytes.toString('utf8'));
  need(value.schema===ENVELOPE&&value.sha256===sha(JSON.stringify(value.draft)),
    'Keep the complete original browser export.');
  await verifyHandover(value.draft);
  return value;
}
function receipt(output,path,bytes){
  const name=relative(output,path);
  need(name&&!name.startsWith('../')&&!isAbsolute(name),'Keep the delivery inside its original output directory.');
  return {path,relativePath:name,bytes:bytes.length,sha256:sha(bytes)};
}
function artifactPath(output,item){
  const name=item.relativePath;
  need(typeof name==='string'&&name&&!isAbsolute(name)&&!name.split(/[\\/]/).includes('..'),
    'Keep the retained operation artifact path.');
  return join(output,name);
}
async function retain(output,path,bytes){
  await publish(path,bytes);return receipt(output,path,bytes);
}
async function draftFile(output,name){
  const path=join(output,name),bytes=await optional(path);
  return bytes?{document:await envelope(bytes),file:receipt(output,path,bytes),bytes}:null;
}
async function download(page,output,name){
  const event=page.waitForEvent('download',{timeout:30000});
  await page.getByRole('button',{name:'Download full draft',exact:true}).click();
  const result=await event,stream=await result.createReadStream();
  need(stream,'The original browser export is unavailable.');
  const chunks=[];let size=0;
  for await(const chunk of stream){size+=chunk.length;need(size<=MAXIMUM,'Keep a complete export within the editor allowance.');chunks.push(chunk);}
  need(!await result.failure(),'The original browser export failed.');
  const bytes=Buffer.concat(chunks),document=await envelope(bytes);
  const file=await retain(output,join(output,name),bytes);
  await result.delete();return {document,file,bytes};
}
function nativeSelection(draft,original,planningSha256,{applied=true}={}){
  const source=draft.planSources?.find(item=>item.sha256===planningSha256);
  need(source&&Buffer.from(source.base64,'base64').equals(original),'Retain the exact original native planning file.');
  const reviews=[draft.planningReview,...[...draft.versions].reverse().map(item=>item.planningReview)]
    .filter(item=>item?.sourceSha===planningSha256);
  const selected=reviews.find(item=>item.applications?.some(application=>application.kind==='answer'&&application.id==='delivery'));
  if(applied)need(selected,'Retain the actual reviewed native plan application to Delivery.');
  const review=selected||reviews[0]||null;
  const application=selected?.applications.filter(item=>item.kind==='answer'&&item.id==='delivery').at(-1)||null;
  return {source,review,application,preview:application?.text||review?.previewText||''};
}
async function browserRecords(page,ids,legacySelection=null){
  return page.evaluate(async ({ids,legacySelection})=>{
    const {listDrafts,loadDraft}=await import('/drafts.mjs');
    const {createDraftEnvelope}=await import('/grant-handover-source.mjs');
    const result=[];
    for(const metadata of await listDrafts()){
      if(!metadata.name?.startsWith('SCF submission — '))continue;
      const record=await loadDraft(metadata.id);
      if(record&&(ids.includes(record.input?.id)||(legacySelection&&record.name==='SCF submission — '+legacySelection.title&&
        record.input?.planSources?.some(source=>source.sha256===legacySelection.planningSha256)))){
        const body=await createDraftEnvelope(record.input,{exportedAt:record.updatedAt});
        result.push({id:record.id,revision:record.revision,name:record.name,updatedAt:record.updatedAt,
          draftId:record.input.id,body});
      }
    }
    return result;
  },{ids,legacySelection});
}

/**
 * Continue the original grant receiver's Page and output directory.
 * An accepted full export is the original delivery. Remaining phases resume
 * from it; later browser revisions are retained through the existing store.
 */
export async function receiveGrantPlanning(page,{
  expectedOrigin,planningFile,planningSha256,outputDirectory,sourceCommit,
  operationId=OPERATION,title,
}={}){
  need(page&&typeof page.goto==='function','Pass the existing grant receiving Playwright Page.');
  need(/^[a-f0-9]{40}$/.test(sourceCommit),'Retain the selected complete installed source commit.');
  need(/^[a-f0-9]{64}$/.test(planningSha256),'Retain the actual original planning file SHA-256.');
  need(typeof operationId==='string'&&operationId.trim(),'Retain the receiving operation identity.');
  const origin=new URL(expectedOrigin),initialUrl=page.url();
  need(origin.origin===expectedOrigin&&origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)&&origin.port,
    'Use the original installed loopback listener.');
  need(new URL(initialUrl).origin===expectedOrigin&&new URL(initialUrl).pathname==='/grant.html',
    'Continue from the original grant reader on this Page.');
  const output=resolve(outputDirectory),selected=resolve(planningFile),original=await ordinary(selected);
  need(sha(original)===planningSha256,'The original planning file differs from the selected saved edition.');
  need(!activePages.has(page)&&!activeOutputs.has(output),'Continue the existing callback already operating this Page and output.');
  activePages.add(page);activeOutputs.add(output);
  try{return await continueOperation();}
  finally{activePages.delete(page);activeOutputs.delete(output);}

  async function continueOperation(){
    await mkdir(output,{recursive:true,mode:0o700});
    const journalPath=join(output,'Planning_Delivery_Journal.json');
    let journalRaw=await optional(journalPath),journal=journalRaw?JSON.parse(journalRaw):null;
    let full=await draftFile(output,'SCF_Native_Plan_Submission.json');
    let prepared=await draftFile(output,'Prepared_Source_Draft.json');
    if(full)nativeSelection(full.document.draft,original,planningSha256);
    const legacyRaw=await optional(join(output,'Planning_Delivery_Result.json'));
    let legacy=null,legacyParseError=null;
    if(legacyRaw)try{legacy=JSON.parse(legacyRaw);}catch(error){legacyParseError=String(error.message||error);}
    const selectedTitle=title??journal?.intent?.title??full?.document.draft.title??prepared?.document.draft.title??'SCF native plan submission';
    const retainedIntent=await optional(join(output,'Planning_Delivery_Intent.json'));
    const proposed={schema:SCHEMA,operationId,planningSha256,planningBytes:original.length,title:selectedTitle,
      initialSourceCommit:retainedIntent?JSON.parse(retainedIntent).initialSourceCommit:legacy?.sourceCommit||sourceCommit};
    if(legacyRaw&&(!legacy||legacy.schema!==SCHEMA))await retain(output,join(output,'attempts','legacy-result-'+sha(legacyRaw)+'.json'),legacyRaw);
    if(legacy){
      need(!legacy.operationId||legacy.operationId===operationId,'Continue the original result operation.');
      need(!legacy.planningSha256||legacy.planningSha256===planningSha256,'Continue the original result planning file.');
    }
    if(retainedIntent)need(canonical(JSON.parse(retainedIntent))===canonical(proposed),'Continue the retained operation, original file and input intent.');
    await retain(output,join(output,'Planning_Delivery_Intent.json'),json(proposed));
    const intentSha256=sha(json(proposed));
    if(journal)need(journal.schema===SCHEMA&&journal.intentSha256===intentSha256,'Continue the original operation journal.');
    else journal={schema:SCHEMA,intent:proposed,intentSha256,phases:{},artifacts:[],sourceEditions:[],browserSnapshots:[]};
    const keep=item=>{
      const index=journal.artifacts.findIndex(previous=>previous.relativePath===item.relativePath);
      if(index<0)journal.artifacts.push(item);
      else need(journal.artifacts[index].sha256===item.sha256,'Keep the original retained artifact identity.');
      return item;
    };
    const commitJournal=async()=>publish(journalPath,json(journal),{replace:true});
    const phase=async(name,details={})=>{
      journal.phases[name]={...details,completedAt:journal.phases[name]?.completedAt||new Date().toISOString()};
      await commitJournal();
    };
    const completeRaw=await optional(join(output,'Planning_Delivery_Complete.json'));
    if(completeRaw){
      const complete=JSON.parse(completeRaw);
      need(complete.intentSha256===intentSha256&&complete.status==='COMPLETE','Keep the original completed operation.');
      const artifacts=[];
      for(const item of complete.artifacts){
        const path=artifactPath(output,item),bytes=await ordinary(path);
        need(bytes.length===item.bytes&&sha(bytes)===item.sha256,'The completed operation artifact differs: '+path);
        artifacts.push({...item,path});
      }
      const result={...complete,artifacts,reused:true,continuation:{...complete.continuation,directory:output}};
      await publish(join(output,'Planning_Delivery_Result.json'),json(result),{replace:true});
      return result;
    }

    const attemptId=randomUUID(),attemptDirectory=join(output,'attempts',attemptId);
    await mkdir(attemptDirectory,{recursive:true,mode:0o700});
    const attempt={schema:SCHEMA,attemptId,operationId,intentSha256,startedAt:new Date().toISOString(),
      sourceCommit,planningFile:selected,expectedOrigin,initialUrl,status:'OPERATING',
      ...(legacyParseError?{retainedLegacyResultSha256:sha(legacyRaw),legacyParseError}:{})};
    journal.currentAttempt=attemptId;journal.status='OPERATING';await commitJournal();
    await publish(join(attemptDirectory,'progress.json'),json(attempt),{replace:true});
    const errors=[],onError=error=>errors.push(String(error.message||error));
    let initialScroll=null,failure=null,viewRestored=false,selection=null,reopened=null;
    let editorOpened=false,currentDocumentSha=null,snapshots=[],activePhase='source';
    const updateAttempt=async(name)=>{
      activePhase=name;attempt.phase=name;attempt.updatedAt=new Date().toISOString();
      await publish(join(attemptDirectory,'progress.json'),json(attempt),{replace:true});
    };
    const ready=async part=>page.waitForFunction(part=>{
      const error=document.getElementById('error');
      if(error&&!error.hidden)throw Error(error.textContent);
      return document.getElementById('status')?.textContent.includes(part);
    },part,{timeout:15000});
    const choose=async(button,path)=>{
      const event=page.waitForEvent('filechooser',{timeout:15000});
      await page.getByRole('button',{name:button,exact:true}).click();
      await(await event).setFiles(path);
    };
    const editor=async()=>{
      if(editorOpened)return;
      await page.goto(expectedOrigin+'/grant-submission.html',{waitUntil:'load',timeout:30000});
      await ready('Opened all nine original answers');editorOpened=true;
    };
    const capture=async name=>{const item=await download(page,output,name);currentDocumentSha=item.document.sha256;return item;};
    const openDraft=async item=>{
      await editor();if(currentDocumentSha===item.document.sha256)return;
      await choose('Open draft file',item.file.path);await ready('Opened the complete draft');currentDocumentSha=item.document.sha256;
    };
    const retainBrowser=async(ids,legacySelection=null)=>{
      const records=await browserRecords(page,[...new Set(ids.filter(Boolean))],legacySelection);
      const result=[];
      for(const record of records){
        const bytes=Buffer.from(record.body),document=await envelope(bytes);
        const file=keep(await retain(output,join(output,'browser-snapshots',sha(record.id),
          'revision-'+record.revision+'-'+sha(bytes)+'.json'),bytes));
        const row={...record,file,document};delete row.body;result.push(row);
        if(!journal.browserSnapshots.some(previous=>previous.id===record.id&&previous.revision===record.revision&&previous.sha256===file.sha256))
          journal.browserSnapshots.push({id:record.id,revision:record.revision,draftId:record.draftId,origin:expectedOrigin,
            updatedAt:record.updatedAt,relativePath:file.relativePath,sha256:file.sha256});
      }
      await commitJournal();return result;
    };
    page.on('pageerror',onError);
    try{
      const routes=new Map(SUBMISSION_ROUTES.map(([route,[filename]])=>[route,filename]));
      routes.set('/drafts.mjs','drafts.mjs');
      const sourceFiles=[];
      for(const [route,filename]of routes){
        const local=await ordinary(fileURLToPath(new URL('./dist/'+filename,import.meta.url)));
        const response=await page.request.get(expectedOrigin+route,{timeout:30000});
        try{need(response.status()===200&&(await response.body()).equals(local),'Install the complete selected editor source at '+route);}
        finally{await response.dispose();}
        sourceFiles.push({route,bytes:local.length,sha256:sha(local)});
      }
      const sourceEdition={sourceCommit,files:sourceFiles};
      if(!journal.sourceEditions.some(item=>canonical(item)===canonical(sourceEdition)))journal.sourceEditions.push(sourceEdition);
      await commitJournal();
      initialScroll=await page.evaluate(()=>({x:scrollX,y:scrollY}));

      if(!full&&!prepared&&legacyRaw){
        await updateAttempt('recover_original_browser_save');
        snapshots=await retainBrowser([],{title:selectedTitle,planningSha256});
        const recovered=snapshots.find(item=>{
          try{nativeSelection(item.document.draft,original,planningSha256);return true;}catch{return false;}
        });
        if(recovered){
          const bytes=await ordinary(recovered.file.path);
          full={document:await envelope(bytes),bytes,file:await retain(output,join(output,'SCF_Native_Plan_Submission.json'),bytes)};
          journal.recoveredLegacyBrowser={id:recovered.id,revision:recovered.revision,draftId:recovered.draftId,origin:expectedOrigin};
          await commitJournal();
        }
      }
      if(!full){
        await updateAttempt('prepare_original_draft');await editor();
        if(!prepared){
          await page.locator('#draft-title').fill(selectedTitle);
          prepared=await capture('Prepared_Source_Draft.json');keep(prepared.file);
          journal.draftId=prepared.document.draft.id;await phase('original_draft',{draftId:journal.draftId});
        }else{journal.draftId=prepared.document.draft.id;keep(prepared.file);await commitJournal();}
        snapshots=await retainBrowser([journal.draftId]);
        const candidates=[...snapshots.map(item=>({document:item.document,file:item.file}))];
        if(journal.workingDraft){
          const file=journal.workingDraft,bytes=await ordinary(artifactPath(output,file));
          need(sha(bytes)===file.sha256,'Retain the interrupted editor bytes.');
          candidates.unshift({document:await envelope(bytes),file:{...file,path:artifactPath(output,file)}});
        }
        const recovered=candidates.find(item=>{
          if(item.document.draft.id!==journal.draftId)return false;
          try{nativeSelection(item.document.draft,original,planningSha256);return true;}catch{return false;}
        });
        if(recovered){
          const bytes=await ordinary(recovered.file.path);
          full={document:await envelope(bytes),bytes,file:await retain(output,join(output,'SCF_Native_Plan_Submission.json'),bytes)};
        }else{
          const working=candidates.find(item=>item.document.draft.id===journal.draftId&&
            item.document.draft.planSources?.some(source=>source.sha256===planningSha256))||prepared;
          await openDraft(working);await page.locator('#view').selectOption('planning');currentDocumentSha=null;
          if(!working.document.draft.planSources?.some(source=>source.sha256===planningSha256)){
            await choose('Receive native plan or planning ZIP',selected);await ready('native plan revisions');
          }
          await page.getByLabel('Retained planning file',{exact:true}).selectOption(planningSha256);
          const revisions=page.getByLabel('Native saved revision',{exact:true});
          const options=await revisions.locator('option').evaluateAll(items=>items.map(item=>item.value));
          need(options.length>0,'The original saved plan revisions did not open.');
          await revisions.selectOption(options[0]);await revisions.selectOption(options.at(-1));
          await page.getByRole('button',{name:'Prepare preview from selected native plan',exact:true}).click();
          const preview=await page.getByLabel('Exact budget and roadmap text to apply',{exact:true}).inputValue();
          need(preview.trim(),'The selected native plan produced an empty preview.');
          await page.getByRole('checkbox',{name:'I have reviewed this exact preview for the selected planning edition.',exact:true}).check();
          await page.getByRole('button',{name:'Apply reviewed plan to draft',exact:true}).click();
          await ready('Applied the reviewed native budget and roadmap');
          need(await page.getByLabel('Draft answer',{exact:true}).inputValue()===preview,'The applied Delivery differs from the selected native preview.');
          full=await capture('SCF_Native_Plan_Submission.json');
        }
      }
      selection=nativeSelection(full.document.draft,original,planningSha256);
      keep(full.file);journal.draftId=full.document.draft.id;
      keep(await retain(output,join(output,'SCF_Native_Plan_Delivery.md'),Buffer.from(selection.preview+'\n')));
      await phase('delivery_exported',{draftId:journal.draftId,draftSha256:full.document.sha256});
      const priorReopened=await draftFile(output,'Reopened_Browser_Submission.json');
      snapshots=await retainBrowser([journal.draftId,journal.browser?.draftId,priorReopened?.document.draft.id]);
      reopened=priorReopened;
      if(!reopened){
        await updateAttempt('browser_saved');
        let record=snapshots.find(item=>item.id===journal.browser?.id&&journal.browser?.origin===expectedOrigin)
          ||snapshots.find(item=>item.document.draft.id===journal.draftId&&stateHash(item.document.draft)===stateHash(full.document.draft))
          ||snapshots.find(item=>item.document.draft.id===journal.draftId&&item.document.draft.planSources?.some(source=>source.sha256===planningSha256));
        if(!record){
          await openDraft(full);await page.getByRole('button',{name:'Save version',exact:true}).click();await ready('Saved browser revision');currentDocumentSha=null;
          snapshots=await retainBrowser([journal.draftId]);
          record=snapshots.find(item=>stateHash(item.document.draft)===stateHash(full.document.draft));
          need(record,'Reopen the accepted save in the original browser draft store.');
        }
        journal.browser={id:record.id,revision:record.revision,draftId:record.draftId,origin:expectedOrigin};
        await phase('browser_saved',journal.browser);
      }

      await updateAttempt('full_export_reopened');
      let fullReadback=await draftFile(output,'Reopened_Full_Submission.json');
      if(!fullReadback){await openDraft(full);fullReadback=await capture('Reopened_Full_Submission.json');}
      need(fullReadback.document.sha256===full.document.sha256,'Reopening changed the accepted complete draft.');
      keep(fullReadback.file);await phase('full_export_reopened',{draftSha256:fullReadback.document.sha256});

      await updateAttempt('original_version_restored');
      const versions=full.document.draft.versions.filter(item=>item.label==='Before receiving native planning edition');
      need(versions.length>0,'Retain the original manuscript version before native plan receiving.');
      let restored=await draftFile(output,'Restored_Previous_Submission.json');
      let baseline=versions.find(item=>item.id===journal.baselineVersionId)||versions.at(-1);
      if(restored){
        baseline=versions.find(item=>stateHash(restoreVersion(full.document.draft,item.id))===stateHash(restored.document.draft));
        need(baseline,'The retained restore differs from the original pre-plan manuscript versions.');
      }else{
        journal.baselineVersionId=baseline.id;await commitJournal();
        await openDraft(full);await page.locator('#view').selectOption('history');
        const before=page.locator('article.card').filter({has:page.getByText(baseline.id,{exact:true})});
        await before.getByRole('button',{name:'Restore this version',exact:true}).click();await ready('Restored the selected version');
        restored=await capture('Restored_Previous_Submission.json');
        need(stateHash(restoreVersion(full.document.draft,baseline.id))===stateHash(restored.document.draft),
          'Restore the complete original manuscript, planning selection and handover selection.');
      }
      nativeSelection(restored.document.draft,original,planningSha256,{applied:false});
      keep(restored.file);journal.baselineVersionId=baseline.id;await phase('original_version_restored',{versionId:baseline.id});

      await updateAttempt('browser_reopened');
      if(!reopened){
        await editor();
        snapshots=await retainBrowser([journal.browser.draftId]);
        const record=snapshots.find(item=>item.id===journal.browser.id);
        need(record,'Open the original saved browser draft record.');
        await page.locator('#view').selectOption('answers');await page.locator('#view').selectOption('saved');
        await page.getByRole('heading',{name:'Browser drafts',exact:true}).waitFor();
        const card=page.locator('article.card').filter({has:page.getByRole('heading',{name:record.name,exact:true})})
          .filter({has:page.getByText('Revision '+record.revision+' · '+record.updatedAt,{exact:true})});
        await card.getByRole('button',{name:'Open this draft',exact:true}).click();await ready('Opened browser revision');
        reopened=await capture('Reopened_Browser_Submission.json');
        need(reopened.document.draft.id===record.draftId,'Open the exact original saved browser draft identity.');
      }
      nativeSelection(reopened.document.draft,original,planningSha256,{applied:false});
      keep(reopened.file);
      await phase('browser_reopened',{draftId:reopened.document.draft.id,draftSha256:reopened.document.sha256,
        laterEditorialState:stateHash(reopened.document.draft)!==stateHash(full.document.draft)});
      need(errors.length===0,'The editor returned a browser error: '+errors.join('; '));
    }catch(error){
      let current=null,editorState=null;
      try{
        if(editorOpened){
          current=await download(page,output,relative(output,join(attemptDirectory,'Interrupted_Editor_Submission.json')));
          keep(current.file);
          if([journal.draftId,prepared?.document.draft.id].includes(current.document.draft.id))journal.workingDraft=current.file;
        }
        editorState=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,
          error:document.getElementById('error')?.textContent,view:document.getElementById('view')?.value}));
      }catch(captureError){attempt.captureError=String(captureError.message||captureError);}
      failure={error:String(error.message||error),phase:activePhase,editor:editorState,pageErrors:errors};
    }finally{
      try{
        if(page.url()!==initialUrl)await page.goto(initialUrl,{waitUntil:'load',timeout:30000});
        if(initialScroll)await page.evaluate(scroll=>scrollTo(scroll.x,scroll.y),initialScroll);viewRestored=page.url()===initialUrl;
      }catch(error){failure??={phase:'reader_restored',pageErrors:errors};failure.restoreError=String(error.message||error);}
      page.off('pageerror',onError);
    }
    if(viewRestored)await phase('reader_restored',{url:initialUrl});
    const summary=selection?planSummary(selection.source,selection.review.revision):null;
    const result={schema:SCHEMA,operationId,intentSha256,sourceCommit:proposed.initialSourceCommit,receivingSourceCommit:sourceCommit,
      planningFile:selected,planningSha256,status:failure||!viewRestored?'INTERRUPTED':'COMPLETE',attemptId,
      ...(summary?{nativePlan:selection.source.document.id,nativeRevisions:selection.source.document.revisions.length,
        award:summary.award,hours:summary.hours,packages:summary.costs.length,
        tranches:summary.tranches.map(item=>({tranche:item.milestone.tranche,amount:item.amount,day:item.milestone.submit_day})),
        draftId:full.document.draft.id,deliveryCharacters:selection.preview.length}:{}),
      artifacts:journal.artifacts.map(item=>({...item,path:artifactPath(output,item)})),phases:journal.phases,
      continuation:{directory:output,intent:'Planning_Delivery_Intent.json',journal:'Planning_Delivery_Journal.json',
        latestResult:'Planning_Delivery_Result.json',completion:failure||!viewRestored?null:'Planning_Delivery_Complete.json'},
      browser:journal.browser||null,preservedBrowserRevisions:journal.browserSnapshots,
      completeExportReopened:Boolean(journal.phases.full_export_reopened),
      originalVersionRestored:Boolean(journal.phases.original_version_restored),
      indexedDBReopened:Boolean(journal.phases.browser_reopened),originalViewRestored:viewRestored,
      ...(failure?{failure}:{}),finishedAt:new Date().toISOString()};
    attempt.status=result.status;attempt.finishedAt=result.finishedAt;attempt.result=result;
    await retain(output,join(attemptDirectory,'attempt.json'),json(attempt));
    journal.status=result.status;journal.lastAttempt=attemptId;delete journal.currentAttempt;await commitJournal();
    if(result.status==='COMPLETE')await retain(output,join(output,'Planning_Delivery_Complete.json'),json(result));
    await publish(join(output,'Planning_Delivery_Result.json'),json(result),{replace:true});
    if(result.status!=='COMPLETE'){
      const error=Error('Continue the original native planning delivery at '+(failure?.phase||activePhase)+': '+
        (failure?.error||failure?.restoreError||'reader restoration remains unfinished'));
      error.result=result;throw error;
    }
    return result;
  }
}
