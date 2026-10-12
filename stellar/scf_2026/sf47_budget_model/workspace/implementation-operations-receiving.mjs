// MIT. Same-case SF74 implementation receiving inside the original SF47 native journey.
import {readFile,open,lstat,realpath,mkdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const hash=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'IMPLEMENTATION_RECEIVING_CONFLICT'});};
async function regular(path){
  need(isAbsolute(path)&&await realpath(path)===path,'Select the retained original regular file without aliases.');
  const before=await lstat(path,{bigint:true});need(before.isFile()&&!before.isSymbolicLink(),'Select the original regular file.');
  const fd=await open(path,'r');
  try{const raw=await fd.readFile(),after=await fd.stat({bigint:true});
    need(['dev','ino','size','mtimeNs','ctimeNs'].every(key=>before[key]===after[key]),'The original file changed while being read.');
    return raw;
  }finally{await fd.close();}
}
async function identity(path){const raw=await regular(path);return{path,bytes:raw.length,sha256:hash(raw)};}
async function exactFile(value){const actual=await identity(value.path);need(actual.bytes===value.bytes&&actual.sha256===value.sha256,'The retained original artifact is unavailable or changed: '+value.path);return actual;}
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function completeSelection(selection){
  need(selection?.schema==='sf47.implementation-native-selection.v1','Use the explicit original implementation selection.');
  need(selection.source&&/^[a-f0-9]{64}$/.test(selection.source.sha256)&&
    Number.isSafeInteger(selection.source.bytes)&&selection.source.bytes>0&&selection.source.bytes<=8*1024*1024,'Retain the original source bytes and SHA-256.');
  need(typeof selection.source.filename==='string'&&selection.source.filename.trim()&&!/[\/\\\x00-\x1f]/.test(selection.source.filename),'Use the original plain filename.');
  need(selection.files===undefined||(Array.isArray(selection.files)&&selection.files.length<=5000),'Retain a bounded explicit original-file selection.');
  need(selection.inputs&&Array.isArray(selection.inputs.selections)&&selection.inputs.selections.length>0,'Explicitly select actual original observations.');
  need(selection.inputs.selections.length<=200,'Select at most 200 original observations.');
  need(typeof selection.inputs.asOfAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(selection.inputs.asOfAt),'Retain the reviewed UTC cutoff.');
}
async function openDesk(page){await page.locator('[data-ops-tab="implementation"]').click();await page.locator('.implementation-evidence-desk').waitFor({state:'visible'});}
async function readSource(page,prefix,sourceId){
  const desk=page.locator('.implementation-evidence-desk');
  await desk.locator('[name="sourceId"]').selectOption(sourceId);
  const wait=page.waitForResponse(r=>new URL(r.url()).pathname===prefix+'/implementation-source'&&r.request().method()==='POST');
  wait.catch(()=>{});await desk.locator('[data-impl-action="read-source"]').click();
  const response=await wait,value=await response.json();need(response.ok(),'The original implementation reader rejected the source: '+JSON.stringify(value));
  return value;
}
async function download(page,locator,path,expected){
  if(expected)return exactFile(expected);
  const wait=page.waitForEvent('download');wait.catch(()=>{});await locator.click();
  const item=await wait,temporary=await item.path();need(temporary,'The original downloaded bytes are unavailable.');
  if(await exists(path))need((await regular(path)).equals(await readFile(temporary)),'The same frozen export differs from its retained original.');
  else await item.saveAs(path);
  return identity(path);
}
export async function receiveImplementationWithOperations({
  page,api,phaseRequest,requestForPhase,screenshot,atomic,state,save,workDirectory,caseId,actor,selection
}){
  completeSelection(selection);
  const output=join(workDirectory,'implementation-receiving');await mkdir(output,{recursive:true,mode:0o700});
  const prefix='/api/operations/'+caseId,selectedHash=hash(Buffer.from(canonical(selection)));
  let phase=state.implementationReceiving;
  if(phase)need(phase.caseId===caseId&&phase.selectionSha256===selectedHash,'Continue the same implementation selection and receiving case.');
  else{
    const before=await api(prefix);
    phase=state.implementationReceiving={caseId,selectionSha256:selectedHash,selection,startedAt:new Date().toISOString(),
      before:await atomic(join(output,'original-case-before-implementation.json'),before)};
    await save();
  }
  await exactFile(phase.before);
  const before=JSON.parse(await regular(phase.before.path));
  let current=await api(prefix),sourceRequest=await requestForPhase('implementation-source');
  if(sourceRequest){
    const result=await phaseRequest('implementation-source',()=>{throw new Error('Recover the original source attachment request.');},prefix+'/command','source.add');
    phase.sourceId=result.recordId;await save();current=await api(prefix);
  }
  if(!phase.sourceId){
    if(selection.source.id){
      need(current.sources.some(row=>row.id===selection.source.id&&row.sha256===selection.source.sha256&&row.bytes===selection.source.bytes),
        'The explicitly selected original source is absent or changed.');phase.sourceId=selection.source.id;
    }else{
      const candidates=current.sources.filter(row=>row.sha256===selection.source.sha256&&row.bytes===selection.source.bytes&&row.filename===selection.source.filename);
      need(candidates.length<=1,'Choose the exact original source ID when several retained records have these bytes.');
      if(candidates.length===1)phase.sourceId=candidates[0].id;
      else{
        need(isAbsolute(selection.source.path||''),'Provide the actual complete source path for original intake.');
        const raw=await regular(selection.source.path);
        need(raw.length===selection.source.bytes&&hash(raw)===selection.source.sha256,'The original implementation carrier differs.');
        await page.locator('[data-ops-tab="sources"]').click();await page.locator('[data-ops-action="attach"]').click();
        const form=page.locator('[data-ops-form]');
        await form.locator('[name="file"]').setInputFiles({name:selection.source.filename,mimeType:'application/json',buffer:raw});
        await form.locator('[name="kind"]').selectOption('work');
        await form.locator('[name="observedAt"]').fill(selection.source.observedAt||selection.inputs.asOfAt);
        await form.locator('[name="sourceUrl"]').fill(selection.source.sourceUrl||'');
        const result=await phaseRequest('implementation-source',()=>form.locator('button[type="submit"]').click(),prefix+'/command','source.add');
        phase.sourceId=result.recordId;
      }
    }
    await save();current=await api(prefix);
  }
  const metadata=current.sources.find(row=>row.id===phase.sourceId);
  need(metadata?.sha256===selection.source.sha256&&metadata.bytes===selection.source.bytes,'The saved original source identity differs.');
  const inputs={...selection.inputs,tranche:selection.inputs.tranche??null,installationRefs:selection.inputs.installationRefs??[],originalFileRefs:phase.originalFileRefs??selection.inputs.originalFileRefs??[],note:selection.inputs.note??'',
    selections:selection.inputs.selections.map(row=>({...row,use:row.use??'EVIDENCE',deploymentIds:row.deploymentIds??[],workIds:row.workIds??[],purchaseIds:row.purchaseIds??[],outcomeIds:row.outcomeIds??[],note:row.note??''})),
    sourceId:metadata.id,sourceSha256:metadata.sha256};
  let originalRequest=await requestForPhase('implementation-freeze');
  if(!originalRequest){
    let seed=await api(prefix+'/implementation-source',{expectedVersion:current.program.version,sourceId:metadata.id,asOfAt:inputs.asOfAt});
    const external=[...new Map(seed.native.externalFiles.map(file=>[file.sha256,file])).values()],fileRefs=[];
    const supplied=new Map((selection.files??[]).map(file=>[file.sha256,file]));
    need(supplied.size===(selection.files??[]).length,'Select each original source file once.');
    for(const file of selection.files??[])need(external.some(row=>row.sha256===file.sha256&&row.bytes===file.bytes),'A supplied file does not belong to the original producer inventory.');
    for(const original of external){
      const expected=(selection.inputs.originalFileRefs??[]).find(row=>row.sha256===original.sha256);
      const spec=supplied.get(original.sha256),phaseName='implementation-original-'+original.sha256;
      let sourceId=expected?.sourceId||spec?.id||null;
      const saved=await requestForPhase(phaseName);
      if(saved){
        const receipt=await phaseRequest(phaseName,()=>{throw new Error('Recover the original source-file attachment.');},prefix+'/command','source.add');
        need(!sourceId||sourceId===receipt.recordId,'The original file attachment names another retained source.');sourceId=receipt.recordId;
      }
      current=await api(prefix);
      if(!sourceId){
        need(spec&&isAbsolute(spec.path||''),'Supply or explicitly bind the exact original file '+original.name);
        const raw=await regular(spec.path);
        need(raw.length===original.bytes&&hash(raw)===original.sha256&&raw.length<=8*1024*1024,'The original source-bundle member differs or exceeds the source bound.');
        need(typeof spec.filename==='string'&&spec.filename&&!/[\/\\\x00-\x1f]/.test(spec.filename),'Retain the original member basename.');
        const matches=current.sources.filter(row=>row.sha256===original.sha256&&row.bytes===original.bytes&&row.filename===spec.filename);
        need(matches.length<=1,'Select the exact existing source ID for the original file.');
        if(matches.length===1)sourceId=matches[0].id;
        else{
          await page.locator('[data-ops-tab="sources"]').click();await page.locator('[data-ops-action="attach"]').click();
          const form=page.locator('[data-ops-form]');
          await form.locator('[name="file"]').setInputFiles({name:spec.filename,mimeType:spec.mediaType||'application/octet-stream',buffer:raw});
          await form.locator('[name="kind"]').selectOption('work');
          await form.locator('[name="observedAt"]').fill(spec.observedAt||selection.source.observedAt||inputs.asOfAt);
          await form.locator('[name="sourceUrl"]').fill(spec.sourceUrl||selection.source.sourceUrl||'');
          const receipt=await phaseRequest(phaseName,()=>form.locator('button[type="submit"]').click(),prefix+'/command','source.add');
          sourceId=receipt.recordId;
        }
      }
      current=await api(prefix);
      need(current.sources.some(row=>row.id===sourceId&&row.sha256===original.sha256&&row.bytes===original.bytes),
        'The exact original file did not reopen under its retained source ID.');
      fileRefs.push({sha256:original.sha256,sourceId});
    }
    phase.originalFileRefs=fileRefs;inputs.originalFileRefs=fileRefs;await save();
    current=await api(prefix);
    seed=await api(prefix+'/implementation-source',{expectedVersion:current.program.version,sourceId:metadata.id,asOfAt:inputs.asOfAt});
    need(seed.source.sha256===metadata.sha256&&seed.native.asOfAt===inputs.asOfAt,'The selected source or cutoff changed.');
    for(const row of inputs.selections){
      const key={task:'tasks',receiving:'receiving',measurement:'measurements'}[row.kind];
      need(key&&seed.native.state[key].some(item=>item.id===row.id),'A selected observation does not exist in the original implementation.');
    }
    phase.inputs=await atomic(join(output,'original-implementation-inputs.json'),inputs);
    const draft={schema:'sf47.implementation-draft.v1',caseId,sourceId:metadata.id,
      draft:{inputs,baseVersion:current.program.version,dirty:true}};
    const draftFile=await atomic(join(output,'original-implementation-draft.json'),draft);
    phase.seed=await atomic(join(output,'original-producer-source-read.json'),seed);await save();
    await openDesk(page);
    const chooser=page.waitForEvent('filechooser');chooser.catch(()=>{});
    await page.locator('[data-impl-action="draft-import"]').click();await (await chooser).setFiles(draftFile.path);
    await page.getByText('Imported the entered draft. Read its exact source and selected cutoff before previewing.',{exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(expected=>document.querySelector('.implementation-evidence-desk [name="sourceId"]')?.value===expected,metadata.id);
    const displayed=await readSource(page,prefix,metadata.id);
    need(canonical(displayed.native)===canonical(seed.native),'The browser changed the original producer projection.');
    await screenshot('10-original-implementation-source');
    await page.locator('[data-impl-action="tab"][data-tab="files"]').click();
    await screenshot('10-original-implementation-files');
    const kinds=[...new Set(inputs.selections.map(row=>row.kind))];
    for(const kind of kinds){
      await page.locator('[data-impl-action="tab"][data-tab="'+kind+'"]').click();
      const first=inputs.selections.find(row=>row.kind===kind);
      const filter=page.locator('.implementation-evidence-desk [name="filter"]');
      await filter.fill(first.id);await page.locator('[data-impl-action="filter"]').click();
      await page.locator('[data-impl-action="detail"][data-kind="'+kind+'"][data-id="'+first.id+'"]').click();
      await page.locator('.implementation-evidence-desk dialog').waitFor({state:'visible'});
      await screenshot('11-original-implementation-'+kind);
      await page.locator('[data-impl-action="close-dialog"]').click();
    }
    await page.locator('[data-impl-action="tab"][data-tab="links"]').click();
    const waiting=page.waitForResponse(r=>new URL(r.url()).pathname===prefix+'/implementation-preview'&&r.request().method()==='POST');waiting.catch(()=>{});
    await page.locator('[data-impl-action="preview"]').click();const response=await waiting,preview=await response.json();
    need(response.ok()&&canonical(preview.inputs)===canonical(inputs),'The original selected implementation preview differs.');
    need(canonical(preview.native)===canonical(seed.native),'The reviewed preview changed the original producer projection.');
    phase.preview=await atomic(join(output,'original-implementation-preview.json'),preview);await save();
    await screenshot('12-implementation-explicit-review');
    const receipt=await phaseRequest('implementation-freeze',()=>page.locator('[data-impl-action="freeze"]').click(),prefix+'/command','implementation.prepare');
    phase.reviewId=receipt.recordId;phase.receipt=receipt;await save();
    originalRequest=await requestForPhase('implementation-freeze');
  }else{
    const receipt=await phaseRequest('implementation-freeze',()=>{throw new Error('Recover the original implementation preparation.');},prefix+'/command','implementation.prepare');
    phase.reviewId=receipt.recordId;phase.receipt=receipt;await save();
  }
  need(originalRequest?.body?.action==='implementation.prepare'&&originalRequest.result?.recordId===phase.reviewId,'Retain the original implementation request and receipt.');
  const review=await api(prefix+'/reviews/'+phase.reviewId);current=await api(prefix);
  need(review.purpose==='IMPLEMENTATION_EVIDENCE'&&review.implementation.previewSha256===originalRequest.body.data.expectedPreviewSha256&&
    canonical(review.implementation.inputs)===canonical(inputs),'The saved review differs from its explicit original request.');
  need(canonical(current.records)===canonical(before.records),'Implementation evidence changed an original business record.');
  for(const key of ['forecasts','portfolios','completionPlans','installations'])
    need(canonical(current[key])===canonical(before[key]),'Implementation evidence changed the original '+key+'.');
  phase.review=await atomic(join(output,'original-frozen-implementation-review.json'),review);
  phase.request=await atomic(join(output,'original-implementation-request.json'),originalRequest);await save();
  await openDesk(page);await page.locator('[data-impl-action="tab"][data-tab="reviews"]').click();
  await page.locator('[data-impl-action="review"][data-id="'+phase.reviewId+'"]').click();
  const bundleLink=page.locator('.implementation-evidence-desk a[href="'+prefix+'/implementation-reviews/'+phase.reviewId+'/export.zip"]').last();
  await bundleLink.waitFor({state:'visible'});
  phase.bundle=await download(page,bundleLink,join(output,'Original_Implementation_Evidence.zip'),phase.bundle);await save();
  await page.setViewportSize({width:390,height:844});await screenshot('13-frozen-implementation-mobile');await page.setViewportSize({width:1440,height:1000});
  if(inputs.tranche){
    await page.locator('[data-ops-tab="completion"]').click();
    await page.locator('[name="completionTranche"]').selectOption(String(inputs.tranche));
    await page.locator('[name="completionImplementation"] option[value="'+phase.reviewId+'"]').waitFor({state:'attached'});
    await page.locator('[name="completionImplementation"]').selectOption([phase.reviewId]);
    const calendar=await api(prefix+'/completion?asOfDate='+inputs.asOfAt.slice(0,10));
    await screenshot('14-implementation-completion-selection');
    phase.completion={reviewId:phase.reviewId,tranche:inputs.tranche,calendar,
      preparationCreated:false,submissionCreated:false,issuerDecisionCreated:false};
  }
  phase.agent={reviewId:phase.reviewId,request:originalRequest.body,receipt:originalRequest.result,bundle:phase.bundle};
  phase.completedAt=new Date().toISOString();await save();return phase;
}
export async function inspectImplementationWithCLI({grantCLI,workspaceDirectory,state,save,atomic,workDirectory}){
  const phase=state.implementationReceiving;if(!phase)return null;
  for(const file of [phase.inputs,phase.review,phase.bundle,phase.request])await exactFile(file);
  const current=await grantCLI(workspaceDirectory,['operations','show','--case',phase.caseId]);
  const review=JSON.parse(await regular(phase.review.path));
  const source=await grantCLI(workspaceDirectory,['operations','implementation-source','--case',phase.caseId,'--source',phase.sourceId,
    '--as-of',review.implementation.inputs.asOfAt,'--expected-version',String(current.program.version)]);
  need(canonical(source.native)===canonical(review.implementation.native),'The native CLI re-read differs from the frozen producer source.');
  const path=join(workDirectory,'implementation-receiving','Original_Implementation_CLI_Evidence.zip');
  if(!phase.cliBundle){
    if(!await exists(path))await grantCLI(workspaceDirectory,['operations','implementation-export','--case',phase.caseId,'--review',phase.reviewId,'--output',path]);
    phase.cliBundle=await identity(path);await save();
  }
  await exactFile(phase.cliBundle);need(phase.cliBundle.sha256===phase.bundle.sha256,'The original browser and CLI frozen packages differ.');
  phase.cli=await atomic(join(workDirectory,'implementation-receiving','original-implementation-cli-readback.json'),{
    source,reviewId:phase.reviewId,bundle:phase.cliBundle});await save();return phase.cli;
}
export async function reopenImplementationWithOperations({page,api,screenshot,restoredCaseId,state,save,atomic,workDirectory}){
  const phase=state.implementationReceiving;if(!phase)return null;
  const prefix='/api/operations/'+restoredCaseId,current=await api(prefix);
  const review=await api(prefix+'/reviews/'+phase.reviewId),original=JSON.parse(await regular(phase.review.path));
  need(canonical(review)===canonical(original),'The full received case changed its original implementation evidence.');
  const row=current.reviews.find(item=>item.id===phase.reviewId);
  need(row?.purpose==='IMPLEMENTATION_EVIDENCE'&&row.implementationCurrent?.current===true,'The received case lost its selected original evidence links.');
  const source=await api(prefix+'/implementation-source',{expectedVersion:current.program.version,sourceId:phase.sourceId,asOfAt:review.implementation.inputs.asOfAt});
  need(canonical(source.native)===canonical(original.implementation.native),'The restored producer projection differs.');
  await openDesk(page);await page.locator('[data-impl-action="tab"][data-tab="reviews"]').click();
  await page.locator('[data-impl-action="review"][data-id="'+phase.reviewId+'"]').click();
  await page.locator('.implementation-evidence-desk a[href="'+prefix+'/implementation-reviews/'+phase.reviewId+'/export.zip"]').last().waitFor({state:'visible'});
  await screenshot('15-reopened-original-implementation');
  phase.reopened=await atomic(join(workDirectory,'implementation-receiving','reopened-original-implementation.json'),{
    caseId:restoredCaseId,reviewId:phase.reviewId,review,sourceCurrent:true,sourceSha256:source.source.sha256});await save();
  return phase.reopened;
}
