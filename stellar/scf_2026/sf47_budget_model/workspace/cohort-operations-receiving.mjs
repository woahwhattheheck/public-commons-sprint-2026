// MIT. Continue the retained original SF47 case through cohort review and receiving.
// Called by buyer-operations-receiving.mjs inside its same owned browser and case.
import {readFile,mkdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const need=(value,message)=>{if(!value)throw Object.assign(new Error(message),{code:'COHORT_RECEIVING_CONFLICT'});};
const pick=rows=>rows.map(row=>row.id).sort();
const dateShift=(date,days)=>{const value=new Date(date+'T00:00:00Z');value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);};
async function identity(path){const raw=await readFile(path);return {path,bytes:raw.length,sha256:sha(raw)};}
async function existing(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function exactFile(file){const value=await identity(file.path);need(value.bytes===file.bytes&&value.sha256===file.sha256,'The retained cohort artifact changed.');return value;}

export async function receiveCohortWithOperations({page,api,phaseRequest,requestForPhase,screenshot,atomic,
  state,save,workDirectory,caseId,actor,sourceId,purchaseId,expectedPurchase}) {
  const prefix='/api/operations/'+caseId,output=join(workDirectory,'cohort-receiving');
  await mkdir(output,{recursive:true,mode:0o700});
  const current=await api(prefix),purchase=current.records.purchases.find(row=>row.id===purchaseId);
  need(purchase&&current.sources.some(row=>row.id===sourceId),'Retain the original purchase and source in this case.');
  for(const key of ['transactionHash','ledger','amountStroops','settlementStatus','outputStatus','deliveredBytes','deliveredSha256'])
    if(Object.hasOwn(expectedPurchase,key))need(canonical(purchase[key])===canonical(expectedPurchase[key]),'Original purchase '+key+' differs before cohort review.');
  need(current.records.purchases.every(row=>row.participantClass==='TEAM_OPERATED'),
    'This original baseline was selected as team operated; review a changed participant population explicitly.');
  if(!state.cohortReceiving) {
    const seeded=await api(prefix+'/cohort-seed',{expectedVersion:current.program.version,tranche:2});
    const inputs=seeded.inputs,cutoff=inputs.asOfAt,day=new Date(cutoff).toISOString().slice(0,10);
    need(seeded.rule.target.proposed_window.consecutive_calendar_days===7,'Use the original proposed seven-day tranche-2 window.');
    inputs.name='Original retained testnet baseline / pre-award review';
    inputs.windowStart=dateShift(day,-6);inputs.windowEnd=day;
    inputs.buyerDeploymentIds=pick(current.records.deployments.filter(row=>['BUYER','BOTH'].includes(row.role)));
    inputs.merchantDeploymentIds=pick(current.records.deployments.filter(row=>['MERCHANT','BOTH'].includes(row.role)));
    need(inputs.buyerDeploymentIds.includes(purchase.deploymentId),'The original buyer deployment is outside the selected cohort.');
    inputs.coverage={state:'PARTIAL',gaps:[],sourceIds:current.sources.map(row=>row.id),
      sourceNote:'This review contains the original retained operating case and its saved purchase history. It does not establish a complete independent-customer observation window or activity absent from those originals.'};
    inputs.note='Native receiving review of the supplied original case. Keep all eight team-operated purchases, their original observations and the unknown award/customer/facilitator conditions. The source and complete output for the original Routescan purchase are reviewed from its retained native handoff; no new purchase is executed.';
    const draft={schema:'stellar-forge.sf47-cohort-draft.v1',originalCaseId:caseId,sourceVersion:current.program.version,inputs};
    const draftFile=await atomic(join(output,'original-review-draft.json'),draft);
    state.cohortReceiving={schema:'sf47.original-cohort-phase.v1',caseId,sourceId,purchaseId,
      beforeVersion:current.program.version,purchaseIds:pick(current.records.purchases),deploymentIds:pick(current.records.deployments),
      originalReviewIds:pick(current.reviews),draft:draftFile,sourceInputs:inputs,startedAt:new Date().toISOString()};
    await save();
  }
  const phase=state.cohortReceiving;
  need(phase.caseId===caseId&&phase.sourceId===sourceId&&phase.purchaseId===purchaseId,'Continue the same original cohort phase.');
  await exactFile(phase.draft);
  await page.locator('[data-ops-tab="cohort"]').click();
  await page.locator('.cohort-desk [name="tranche"]').waitFor({state:'visible'});
  let savedRequest=await requestForPhase('cohort-freeze');
  if(!savedRequest) {
    await page.locator('[data-cohort-import]').setInputFiles(phase.draft.path);
    await page.locator('[data-cohort-main] [name="name"]').waitFor({state:'visible'});
    need(await page.locator('[data-cohort-main] [name="name"]').inputValue()===phase.sourceInputs.name,'The browser did not retain the reviewed cohort input.');
    await page.locator('[data-cohort-action="tab"][data-tab="purchases"]').click();
    await page.locator('[data-cohort-action="edit"][data-kind="bindings"][data-id="'+purchaseId+'"]').click();
    const form=page.locator('[data-cohort-editor]');
    await form.locator('[name="buyerDeploymentId"]').selectOption(purchase.deploymentId);
    await form.locator('[name="transferVerified"]').check();
    await form.locator('[name="outputAccepted"]').check();
    await form.locator('[name="sourceIds"]').selectOption([sourceId]);
    await form.locator('[name="sourceNote"]').fill('Original native Routescan handoff: transaction '+purchase.transactionHash+
      ', ledger '+purchase.ledger+', '+purchase.amountStroops+' stroops; retained complete output '+purchase.deliveredBytes+
      ' bytes, SHA-256 '+purchase.deliveredSha256+'. The original independently checked payment/finality and saved result are retained. Useful-operation and facilitator associations remain unentered.');
    await form.locator('button[type="submit"]').click();
    await page.locator('[data-cohort-action="tab"][data-tab="evaluate"]').click();
    const previewWait=page.waitForResponse(response=>new URL(response.url()).pathname===prefix+'/cohort-preview'&&response.request().method()==='POST');
    await page.locator('[data-cohort-action="preview"]').click();
    const response=await previewWait,value=await response.json();
    need(response.ok(),'Original cohort preview failed: '+JSON.stringify(value));
    need(value.ready===false&&value.window.awardAcceptanceOn===null&&value.metrics.independent.complete===0,
      'The original team-operated pre-award baseline must retain its unmet independent-cohort findings.');
    need(value.observations.length===current.records.purchases.length,'The complete original selected purchase population is not visible.');
    phase.preview=await atomic(join(output,'original-cohort-preview.json'),value);
    phase.inputs=await atomic(join(output,'original-cohort-inputs.json'),value.inputs);await save();
    await screenshot('06-original-cohort-denominators-desktop');
    const receipt=await phaseRequest('cohort-freeze',()=>page.locator('[data-cohort-action="freeze"]').click(),prefix+'/command','cohort.prepare');
    phase.reviewId=receipt.recordId;phase.receipt=receipt;await save();
    savedRequest=await requestForPhase('cohort-freeze');
  } else {
    const receipt=await phaseRequest('cohort-freeze',()=>{throw new Error('Reuse the retained original cohort request.');},prefix+'/command','cohort.prepare');
    phase.reviewId=receipt.recordId;phase.receipt=receipt;await save();
  }
  need(savedRequest?.body?.action==='cohort.prepare'&&savedRequest.result?.recordId===phase.reviewId,
    'Retain the exact original cohort request and committed result.');
  const review=await api(prefix+'/reviews/'+phase.reviewId),after=await api(prefix);
  need(review.purpose==='COHORT_EVALUATION'&&review.cohort.previewSha256===savedRequest.body.data.expectedPreviewSha256,
    'The frozen cohort differs from its original reviewed request.');
  need(review.cohort.ready===false&&review.cohort.metrics.independent.complete===0,'The retained baseline acquired an unsupported independent target.');
  need(canonical(pick(after.records.purchases))===canonical(phase.purchaseIds)&&
    canonical(pick(after.records.deployments))===canonical(phase.deploymentIds),'Cohort review changed the original purchase/deployment identities.');
  phase.review=await atomic(join(output,'original-frozen-cohort.json'),review);
  phase.request=await atomic(join(output,'original-freeze-request.json'),savedRequest);await save();
  await page.locator('[data-cohort-action="tab"][data-tab="saved"]').click();
  await page.locator('[data-cohort-action="review"][data-id="'+phase.reviewId+'"]').click();
  await page.locator('[data-cohort-action="download-review"]').waitFor({state:'visible'});
  if(!phase.bundle) {
    const downloadWait=page.waitForEvent('download');
    await page.locator('[data-cohort-action="download-review"]').click();
    const download=await downloadWait,path=join(output,'Original_Cohort_Evidence.zip'),downloadPath=await download.path();
    need(downloadPath,'The complete original frozen download is unavailable.');
    if(await existing(path))need((await readFile(path)).equals(await readFile(downloadPath)),
      'The retained cohort download differs from the same original frozen export.');
    else await download.saveAs(path);
    phase.bundle=await identity(path);await save();
  } else await exactFile(phase.bundle);
  await page.setViewportSize({width:390,height:844});await screenshot('07-frozen-cohort-mobile');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-ops-tab="completion"]').click();
  await page.locator('[name="completionTranche"]').waitFor({state:'visible'});
  await page.locator('[name="completionTranche"]').selectOption('2');
  await page.locator('[name="completionCohorts"] option[value="'+phase.reviewId+'"]').waitFor({state:'attached'});
  await page.locator('[name="completionCohorts"]').selectOption([phase.reviewId]);
  const clock=await api(prefix+'/completion?asOfDate='+review.cohort.inputs.asOfAt.slice(0,10));
  need(!clock.clocks.some(row=>row.tranche===2&&row.active),'This supplied pre-award case unexpectedly has an actual tranche-1 payment; review its source.');
  need(await page.locator('[data-completion-action="preview"]').isDisabled()&&
    await page.locator('[data-completion-action="prepare"]').isDisabled(),'Do not manufacture a paid-tranche preparation for the original unpaid case.');
  await screenshot('08-original-completion-cohort-selection');
  phase.completion={selectedReviewId:phase.reviewId,clockEstablished:false,submissionCreated:false};
  phase.agent={reviewId:phase.reviewId,request:savedRequest.body,receipt:savedRequest.result,bundle:phase.bundle};
  phase.completedAt=new Date().toISOString();await save();
  return phase;
}

export async function inspectCohortWithCLI({grantCLI,workspaceDirectory,state,save,atomic,workDirectory}) {
  const phase=state.cohortReceiving;if(!phase)return null;
  await exactFile(phase.inputs);await exactFile(phase.review);await exactFile(phase.bundle);
  const review=JSON.parse(await readFile(phase.review.path,'utf8'));
  const current=await grantCLI(workspaceDirectory,['operations','show','--case',phase.caseId]);
  const seed=await grantCLI(workspaceDirectory,['operations','cohort-seed','--case',phase.caseId,
    '--expected-version',String(current.program.version),'--tranche','2']);
  need(seed.source.version===current.program.version,'The CLI reopened another original case version.');
  const preview=await grantCLI(workspaceDirectory,['operations','cohort-preview','--case',phase.caseId,
    '--expected-version',String(current.program.version),'--inputs',phase.inputs.path]);
  need(preview.source.measurementSha256===review.cohort.source.measurementSha256,'The native CLI selected another cohort measurement source.');
  const path=join(workDirectory,'cohort-receiving','Original_Cohort_CLI_Evidence.zip');
  if(!phase.cliBundle) {
    if(await existing(path)) {
      const found=await identity(path);need(found.sha256===phase.bundle.sha256,'A retained CLI export differs from the original UI export.');
      phase.cliBundle=found;
    } else {
      await grantCLI(workspaceDirectory,['operations','cohort-export','--case',phase.caseId,'--review',phase.reviewId,'--output',path]);
      phase.cliBundle=await identity(path);
    }
    await save();
  }
  await exactFile(phase.cliBundle);
  need(phase.cliBundle.sha256===phase.bundle.sha256,'The original UI and CLI exports differ.');
  phase.cli=await atomic(join(workDirectory,'cohort-receiving','original-cli-readback.json'),{seed,preview,bundle:phase.cliBundle});await save();
  return {reviewId:phase.reviewId,measurementSha256:preview.source.measurementSha256,bundleSha256:phase.cliBundle.sha256};
}

export async function reopenCohortWithOperations({page,api,screenshot,restoredCaseId,state,save,atomic,workDirectory}) {
  const phase=state.cohortReceiving;if(!phase)return null;
  const current=await api('/api/operations/'+restoredCaseId);
  const summary=current.reviews.find(row=>row.id===phase.reviewId);
  need(summary?.purpose==='COHORT_EVALUATION'&&summary.cohortSourceCurrent===true,'The complete received case lost its current original cohort measurement.');
  const review=await api('/api/operations/'+restoredCaseId+'/reviews/'+phase.reviewId),original=JSON.parse(await readFile(phase.review.path,'utf8'));
  need(canonical(review)===canonical(original),'The received frozen cohort source/history or review identity changed.');
  await page.locator('[data-ops-tab="cohort"]').click();
  await page.locator('[data-cohort-action="tab"][data-tab="saved"]').waitFor({state:'visible'});
  await page.locator('[data-cohort-action="tab"][data-tab="saved"]').click();
  await page.locator('[data-cohort-action="review"][data-id="'+phase.reviewId+'"]').click();
  await page.locator('[data-cohort-action="download-review"]').waitFor({state:'visible'});
  await screenshot('09-reopened-original-cohort');
  const response=await api('/api/operations/'+restoredCaseId+'/cohort-preview',
    {expectedVersion:current.program.version,inputs:review.cohort.inputs});
  need(response.source.measurementSha256===review.cohort.source.measurementSha256,'The restored case changes the original measurement digest.');
  phase.reopened=await atomic(join(workDirectory,'cohort-receiving','reopened-cohort.json'),{
    caseId:restoredCaseId,reviewId:phase.reviewId,review,sourceCurrent:summary.cohortSourceCurrent,
    measurementSha256:response.source.measurementSha256});await save();
  return {caseId:restoredCaseId,reviewId:phase.reviewId,sourceCurrent:true,measurementSha256:response.source.measurementSha256};
}
