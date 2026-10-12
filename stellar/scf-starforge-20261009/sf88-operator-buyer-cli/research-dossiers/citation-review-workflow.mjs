#!/usr/bin/env node
// MIT. One complete citation-review workflow through the original dossier,
// authenticated browser, revision reports and both original portable readers.
import {parseArgs} from 'node:util';
import {resolve,join,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstat} from 'node:fs/promises';
import {openDossierStore} from './dossier.mjs';
import {startDossierWorkspace} from './server.mjs';
import {validateCrossrefEdition} from './crossref.mjs';
import {validateCrossrefDocumentEdition} from './crossref-documents.mjs';
import {citationDigest} from './citation-updates.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {openPortableFile,writePortableFile} from './portable.mjs';
import {privateDirectory,writeJson,readJson,writeBytes,readBytes,parseJson,jsonBytes,digest,need,object} from '../node/store.mjs';

const SCHEMA='sf88-citation-review-workflow.v1';
const MAX_SOURCE=64*1024*1024,MAX_PORTABLE=256*1024*1024;
const exists=async file=>{try{const value=await lstat(file);need(value.isFile()&&!value.isSymbolicLink(),'WORKFLOW_FILE_INVALID');return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}};
const optionalJson=async file=>await exists(file)?readJson(file,16*1024*1024):null;
const same=(left,right)=>citationDigest(left)===citationDigest(right);
async function immutableBytes(file,bytes){
  if(await exists(file)){
    const existing=await readBytes(file,MAX_PORTABLE);
    need(existing.length===bytes.length&&digest(existing)===digest(bytes),'WORKFLOW_ARTIFACT_CHANGED');return;
  }
  try{await writeBytes(file,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;const saved=await readBytes(file,MAX_PORTABLE);
    need(saved.length===bytes.length&&digest(saved)===digest(bytes),'WORKFLOW_ARTIFACT_CHANGED');}
}
async function identity(file){
  const body=await readResearchHostFile(file,MAX_PORTABLE);
  return {file,bytes:body.length,sha256:digest(body)};
}
async function notices(store,id,revision){
  const rows=[];let offset=0;
  while(true){
    const page=await store.citationUpdates(id,{revision,offset,limit:100});
    rows.push(...page.items);
    if(page.nextOffset===null)return rows;offset=page.nextOffset;
  }
}
async function selectNotice(store,id,revision,targetDoi){
  const rows=await notices(store,id,revision);
  for(const row of rows){
    if(targetDoi&&row.targetDoi!==targetDoi)continue;
    const detail=await store.citationUpdates(id,{revision,noticeId:row.noticeId});
    if(detail.detail.evidence.length)return detail.detail;
  }
  need(false,'WORKFLOW_RETAINED_NOTICE_AND_TARGET_REQUIRED');
}

async function prepare({store,runDirectory,binding,raw,targetDoi}){
  const file=join(runDirectory,'seed.json'),existing=await optionalJson(file);
  if(existing){need(same(existing.binding,binding),'WORKFLOW_INPUT_CHANGED');
    const saved=await store.getMetadata(existing.dossierId,{revision:existing.originalRevision});
    need(saved.revision===existing.originalRevision,'WORKFLOW_SEED_CHANGED');return existing;}
  const title='Citation update review / '+binding.operation;
  const matches=(await store.list()).filter(value=>value.title===title);
  need(matches.length<=1,'WORKFLOW_DOSSIER_AMBIGUOUS');
  let metadata=matches.length?await store.getMetadata(matches[0].id):
    await store.create({title,description:'Review the original registered notice and its source use across two research questions.',
      projection:'metadata'});
  const id=metadata.id,questionTexts=[
    'How does the registered notice affect this publication in the primary evidence review?',
    'How should the same publication be used in the related evidence summary?'
  ];
  const questionIds=[];
  for(const questionText of questionTexts){
    let rows=metadata.questions.filter(value=>value.text===questionText);
    need(rows.length<=1,'WORKFLOW_QUESTION_AMBIGUOUS');
    if(!rows.length){metadata=await store.addQuestion(id,{text:questionText,expectedRevision:metadata.revision,projection:'metadata'});
      rows=metadata.questions.filter(value=>value.text===questionText);}
    const question=rows[0];questionIds.push(question.id);
    metadata=await store.receive(id,{questionId:question.id,label:'Original registered notice and work metadata',
      provider:binding.provider,rawBytes:raw,sourceReference:binding.sourceReference,
      origin:{mode:'citation-review-workflow',operation:binding.operation,inputSha256:binding.editionSha256},
      expectedRevision:metadata.revision,projection:'metadata'});
  }
  let notice=await selectNotice(store,id,metadata.revision,targetDoi);
  const view=await store.get(id,{revision:metadata.revision,references:false,includeHistory:false});
  const source=view.sources.find(value=>value.doi===notice.targetDoi);
  need(source,'WORKFLOW_TARGET_SOURCE_REQUIRED');
  const note='Selected for review against registered notice '+notice.noticeDoi+'.';
  const currentSelections=notice.evidence.filter(value=>questionIds.includes(value.questionId));
  if(currentSelections.some(value=>!value.selected||value.classification!=='background'||value.note!==note))
    metadata=await store.selectEvidence(id,{sourceId:source.id,selected:true,classification:'background',note,
      expectedRevision:metadata.revision,projection:'metadata'});
  for(const [index,questionId]of questionIds.entries()){
    const findingTitle='Citation assessment / question '+(index+1);
    const rows=metadata.findings.filter(value=>value.questionId===questionId&&value.title===findingTitle);
    need(rows.length<=1,'WORKFLOW_FINDING_AMBIGUOUS');
    if(!rows.length)metadata=await store.addFinding(id,{questionId,title:findingTitle,
      text:'The source '+notice.targetDoi+' is retained in this evidence review. Its registered '+notice.type+
        ' notice '+notice.noticeDoi+' requires an explicit decision about the source use and citation.',
      sourceIds:[source.id],expectedRevision:metadata.revision,projection:'metadata'});
  }
  notice=(await store.citationUpdates(id,{revision:metadata.revision,noticeId:notice.noticeId})).detail;
  need(notice.findings.length===2&&notice.evidence.filter(value=>value.selected).length===2,
    'WORKFLOW_SOURCE_JOIN_INCOMPLETE');
  const seed={schema:SCHEMA,binding,dossierId:id,noticeId:notice.noticeId,noticeDoi:notice.noticeDoi,
    targetDoi:notice.targetDoi,sourceId:source.id,questionIds,findingIds:notice.findings.map(value=>value.id),
    originalRevision:metadata.revision,originalFingerprint:notice.fingerprint,preparedAt:new Date().toISOString()};
  try{await writeJson(file,seed,{exclusive:true});}catch(error){if(error.code!=='EEXIST')throw error;
    const saved=await readJson(file,1024*1024);need(same(saved,seed),'WORKFLOW_SEED_CHANGED');}
  return seed;
}

async function portable({store,id,revision,file,compression}){
  if(!(await exists(file)))await writePortableFile(file,await store.exportStream(id,{revision,compression}));
  return identity(file);
}
async function reports({store,id,selection,directory}){
  const artifacts=[];
  for(const [label,revision]of [['original',selection.originalRevision],['reviewed',selection.reviewedRevision],
    ['current',selection.currentRevision]]){
    for(const format of ['md','html']){
      const exported=await store.exportDossier(id,{format,revision});
      need(exported.revision===revision,'WORKFLOW_REPORT_REVISION_CHANGED');
      const file=join(directory,label+'-r'+revision+'.'+format);
      await immutableBytes(file,Buffer.from(exported.body));
      artifacts.push({...await identity(file),kind:'report',revision,format});
    }
  }
  artifacts.push({...await portable({store,id,revision:selection.currentRevision,
    file:join(directory,'complete.research.json'),compression:'none'}),kind:'portable',format:'json',
    revision:selection.currentRevision});
  artifacts.push({...await portable({store,id,revision:selection.currentRevision,
    file:join(directory,'complete.research.json.gz'),compression:'gzip'}),kind:'portable',format:'json.gz',
    revision:selection.currentRevision});
  return artifacts;
}
async function verifyReopened({original,received,id,selection,noticeId,rawSha256}){
  const left=await original.getMetadata(id,{revision:selection.currentRevision});
  const right=await received.getMetadata(id,{revision:selection.currentRevision});
  need(same(left,right),'WORKFLOW_REOPENED_METADATA_CHANGED');
  const leftDetail=await original.citationUpdates(id,{revision:selection.currentRevision,noticeId});
  const rightDetail=await received.citationUpdates(id,{revision:selection.currentRevision,noticeId});
  need(same(leftDetail,rightDetail),'WORKFLOW_REOPENED_REVIEW_CHANGED');
  need(rightDetail.detail.reviews.some(value=>value.id===selection.reviewId),'WORKFLOW_REVIEW_MISSING');
  const bodies=[];
  for(const edition of left.editions.filter(value=>value.mode==='retained')){
    const source=await original.readRetainedEdition(id,edition.id,{revision:selection.currentRevision});
    const copy=await received.readRetainedEdition(id,edition.id,{revision:selection.currentRevision});
    need(source.bytes.equals(copy.bytes),'WORKFLOW_REOPENED_SOURCE_CHANGED');
    bodies.push({editionId:edition.id,bytes:copy.bytes.length,sha256:digest(copy.bytes)});
  }
  need(bodies.some(value=>value.sha256===rawSha256),'WORKFLOW_ORIGINAL_SOURCE_MISSING');
  for(const revision of [...new Set([selection.originalRevision,selection.reviewedRevision,selection.currentRevision])]){
    for(const format of ['md','html']){
      const a=await original.exportDossier(id,{revision,format});
      const b=await received.exportDossier(id,{revision,format});
      need(a.body===b.body,'WORKFLOW_REOPENED_REPORT_CHANGED');
    }
  }
  return {dossierId:id,revision:right.revision,reviewId:selection.reviewId,
    sourceBodies:bodies,status:rightDetail.detail.status};
}
async function rejectAlteredReview({portableFile,selection,runDirectory}){
  const incoming=parseJson(await readBytes(portableFile,MAX_PORTABLE));
  let changed=0,previous=null;
  for(const envelope of incoming.versions){
    const review=envelope.state.citationReviews?.find(value=>value.id===selection.reviewId);
    if(review){
      // Keep the saved request unchanged and change only its claimed original
      // source occurrence. Rehash the review and outer history so rejection
      // exercises source replay, rather than a broken transport checksum.
      review.notice.latestSource.key='999999';
      review.notice.latestSource.occurrenceId='o_'+digest(Buffer.from(
        review.notice.latestSource.editionId+'\n'+review.notice.latestSource.key));
      const {sha256,...payload}=review;review.sha256=citationDigest(payload);changed++;
    }
    envelope.state.previous=previous;envelope.sha256=digest(jsonBytes(envelope.state));previous=envelope.sha256;
  }
  need(changed>0,'WORKFLOW_REVIEW_MISSING');
  const destination=await openDossierStore(join(runDirectory,'rejected-review'));
  need((await destination.list()).length===0,'WORKFLOW_REJECTION_DESTINATION_CHANGED');
  let code;
  try{await destination.reopen(incoming);}catch(error){code=error.code;}
  need(code==='PORTABLE_CITATION_REPLAY_CHANGED','WORKFLOW_ALTERED_REVIEW_ACCEPTED');
  need((await destination.list()).length===0,'WORKFLOW_REJECTED_REVIEW_PUBLISHED');
  return {code,dossierCount:0};
}

export async function runCitationReviewWorkflow({operation,editionFile,editionSha256,runDirectory,
  playwrightModule,chromiumExecutable,targetDoi,sourceReference='Retained original Crossref metadata edition'}){
  need(typeof operation==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(operation),'WORKFLOW_OPERATION_REQUIRED');
  need(typeof editionSha256==='string'&&/^[a-f0-9]{64}$/.test(editionSha256),'WORKFLOW_SOURCE_DIGEST_REQUIRED');
  for(const value of [editionFile,runDirectory,playwrightModule,chromiumExecutable])
    need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'WORKFLOW_ABSOLUTE_PATH_REQUIRED');
  const raw=await readResearchHostFile(editionFile,MAX_SOURCE,{sha256:editionSha256}),envelope=parseJson(raw);
  if(envelope.provider==='crossref-document')validateCrossrefDocumentEdition(envelope);
  else validateCrossrefEdition(envelope);
  need(targetDoi===undefined||typeof targetDoi==='string'&&targetDoi.length<=512,'WORKFLOW_TARGET_INVALID');
  runDirectory=await privateDirectory(runDirectory);
  const binding={operation,editionSha256,editionBytes:raw.length,provider:envelope.provider,sourceReference,
    targetDoi:targetDoi??null};
  const bindingFile=join(runDirectory,'input.json'),savedBinding=await optionalJson(bindingFile);
  if(savedBinding)need(same(savedBinding,binding),'WORKFLOW_INPUT_CHANGED');
  else await writeJson(bindingFile,binding,{exclusive:true});
  const resultFile=join(runDirectory,'result.json'),existing=await optionalJson(resultFile);
  if(existing){
    need(existing.schema===SCHEMA&&existing.state==='COMPLETE'&&same(existing.binding,binding),'WORKFLOW_RESULT_CHANGED');
    for(const artifact of existing.artifacts){
      need(typeof artifact.file==='string'&&artifact.file&&!isAbsolute(artifact.file)&&
        !artifact.file.split(/[\\/]/).some(value=>value==='..'||value==='.'||!value),
        'WORKFLOW_ARTIFACT_PATH_INVALID');
      const checked=await identity(join(runDirectory,artifact.file));
      need(checked.bytes===artifact.bytes&&checked.sha256===artifact.sha256,'WORKFLOW_ARTIFACT_CHANGED');
    }
    return {...existing,recovered:true};
  }
  const workspace=join(runDirectory,'workspace'),store=await openDossierStore(workspace);
  const seed=await prepare({store,runDirectory,binding,raw,targetDoi});
  const connectionFile=join(runDirectory,'connection.json'),previousConnection=await optionalJson(connectionFile);
  if(previousConnection)need(previousConnection.directory===workspace,'WORKFLOW_CONNECTION_CHANGED');
  const port=previousConnection?Number(new URL(previousConnection.url).port):0;
  const app=await startDossierWorkspace({directory:workspace,port});
  let browser,selection,merchant;
  try{
    await writeJson(connectionFile,{schema:'stellar-forge.research-workspace-connection.v1',
      mode:'RESEARCH_DOSSIER_WORKSPACE',directory:workspace,url:app.url,workspaceId:app.workspaceId,instanceId:app.instanceId});
    const {runCitationReviewBrowser}=await import('./citation-review-browser.mjs');
    browser=await runCitationReviewBrowser({url:app.url,dossierId:seed.dossierId,noticeId:seed.noticeId,
      runDirectory,playwrightModule,chromiumExecutable});
    need(object(browser)&&typeof browser.reviewId==='string'&&Number.isSafeInteger(browser.originalRevision)&&
      Number.isSafeInteger(browser.reviewedRevision)&&Number.isSafeInteger(browser.currentRevision),
      'WORKFLOW_BROWSER_REVIEW_REQUIRED');
    const selectionFile=join(runDirectory,'completion-selection.json'),prior=await optionalJson(selectionFile);
    if(prior){need(prior.reviewId===browser.reviewId,'WORKFLOW_REVIEW_SELECTION_CHANGED');selection=prior;}
    else{
      selection={dossierId:seed.dossierId,noticeId:seed.noticeId,reviewId:browser.reviewId,
        originalRevision:browser.originalRevision,reviewedRevision:browser.reviewedRevision,currentRevision:browser.currentRevision};
      await writeJson(selectionFile,selection,{exclusive:true});
    }
    const detail=await store.citationUpdates(seed.dossierId,{noticeId:seed.noticeId,revision:selection.currentRevision});
    const review=detail.detail.reviews.find(value=>value.id===selection.reviewId);
    need(review&&review.originalRevision===selection.originalRevision&&review.revision===selection.reviewedRevision,
      'WORKFLOW_REVIEW_SELECTION_CHANGED');
    const before=(await store.getMetadata(seed.dossierId)).revision;
    const duplicate=await store.reviewCitationUpdate(seed.dossierId,review.request);
    need(duplicate.duplicate&&duplicate.review.id===review.id&&
      (await store.getMetadata(seed.dossierId)).revision===before,'WORKFLOW_REQUEST_RECOVERY_CHANGED');
    const {runCitationReviewMerchant}=await import('./citation-review-merchant.mjs');
    merchant=await runCitationReviewMerchant({url:app.url,workspaceDirectory:workspace,runDirectory,
      dossierId:seed.dossierId,noticeId:seed.noticeId,selection,reviewRequest:review.request});
    need(merchant?.reviewId===review.id&&merchant.originalRevision===selection.originalRevision&&
      merchant.reviewedRevision===selection.reviewedRevision&&merchant.currentRevision===selection.currentRevision,
      'WORKFLOW_MERCHANT_SELECTION_CHANGED');
    need((await store.getMetadata(seed.dossierId)).revision===before,'WORKFLOW_MERCHANT_REPLAY_CREATED_REVISION');
  }finally{await app.close();}
  const outputDirectory=await privateDirectory(join(runDirectory,'delivery'));
  await immutableBytes(join(outputDirectory,'original-source-edition.json'),raw);
  const artifacts=await reports({store,id:seed.dossierId,selection,directory:outputDirectory});
  artifacts.push({...await identity(join(outputDirectory,'original-source-edition.json')),kind:'source'});
  const jsonFile=join(outputDirectory,'complete.research.json'),gzipFile=jsonFile+'.gz';
  const jsonStore=await openDossierStore(join(runDirectory,'reopened-json'));
  await jsonStore.reopen(parseJson(await readBytes(jsonFile,MAX_PORTABLE)));
  const jsonReopen=await verifyReopened({original:store,received:jsonStore,id:seed.dossierId,
    selection,noticeId:seed.noticeId,rawSha256:editionSha256});
  const gzipStore=await openDossierStore(join(runDirectory,'reopened-gzip'));
  await gzipStore.reopenStream(await openPortableFile(gzipFile),{projection:'metadata'});
  const gzipReopen=await verifyReopened({original:store,received:gzipStore,id:seed.dossierId,
    selection,noticeId:seed.noticeId,rawSha256:editionSha256});
  const alteredReview=await rejectAlteredReview({portableFile:jsonFile,selection,runDirectory});
  const nativeOutputs=[
    ...(Array.isArray(browser.nativeOutputs)?browser.nativeOutputs:[]).map(output=>({output,kind:'browser'})),
    ...(Array.isArray(merchant.nativeOutputs)?merchant.nativeOutputs:[]).map(output=>({output,kind:'merchant'}))
  ];
  for(const {output,kind} of nativeOutputs){
    const candidate=typeof output==='string'?output:output.file??output.path??output.filename;
    need(typeof candidate==='string','WORKFLOW_NATIVE_ARTIFACT_INVALID');
    const file=isAbsolute(candidate)?candidate:join(runDirectory,candidate),name=relative(runDirectory,file);
    need(name&&!name.startsWith('..'+sep)&&!isAbsolute(name)&&
      !name.split(sep).some(value=>['connection.json','connection.private.json','retained-exports','citation-browser-profile','source-state','workspace',
        'reopened-json','reopened-gzip','rejected-review'].includes(value)),'WORKFLOW_PRIVATE_ARTIFACT_REFUSED');
    const checked=await identity(file);
    if(object(output))need((output.bytes===undefined||output.bytes===checked.bytes)&&
      (output.sha256===undefined||output.sha256===checked.sha256),'WORKFLOW_NATIVE_ARTIFACT_CHANGED');
    artifacts.push({...checked,kind});
  }
  const unique=new Map();
  for(const artifact of artifacts){
    const name=relative(runDirectory,artifact.file);
    need(!name.startsWith('..'+sep)&&!isAbsolute(name),'WORKFLOW_ARTIFACT_PATH_INVALID');
    const value={...artifact,file:name.split(sep).join('/')},old=unique.get(value.file);
    need(!old||old.sha256===value.sha256&&old.bytes===value.bytes,'WORKFLOW_ARTIFACT_CHANGED');unique.set(value.file,value);
  }
  const result={schema:SCHEMA,state:'COMPLETE',operation,binding,seed,selection,
    merchant:{workspaceId:merchant.workspaceId,exports:merchant.exports},jsonReopen,gzipReopen,
    alteredReview,artifacts:[...unique.values()],completedAt:new Date().toISOString()};
  await writeJson(resultFile,result,{exclusive:true});
  return result;
}

async function main(){
  const {values}=parseArgs({options:Object.fromEntries(
    ['operation','edition-file','sha256','run-directory','playwright-module','chromium','target-doi','source-reference']
      .map(value=>[value,{type:'string'}])),strict:true});
  const result=await runCitationReviewWorkflow({operation:values.operation,editionFile:values['edition-file'],
    editionSha256:values.sha256,runDirectory:values['run-directory'],playwrightModule:values['playwright-module'],
    chromiumExecutable:values.chromium,targetDoi:values['target-doi'],sourceReference:values['source-reference']});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'CITATION_WORKFLOW_FAILED'})+'\n');process.exitCode=1;});
