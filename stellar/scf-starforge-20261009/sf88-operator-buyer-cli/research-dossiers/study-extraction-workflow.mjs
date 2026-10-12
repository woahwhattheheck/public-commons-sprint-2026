#!/usr/bin/env node
// MIT. Complete original study extraction, publication and receiving programme.
import {parseArgs} from 'node:util';
import {isAbsolute,resolve,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstat} from 'node:fs/promises';
import {openDossierStore} from './dossier.mjs';
import {startDossierWorkspace} from './server.mjs';
import {extractionDigest,extractionInput,extractionDefinition} from './study-extraction.mjs';
import {eligibilityInput} from './eligibility-review.mjs';
import {publicationInput,publicationDefinition} from './extraction-publication.mjs';
import {openPortableFile,writePortableFile} from './portable.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {privateDirectory,readJson,writeJson,readBytes,writeBytes,jsonBytes,digest,need,object} from '../node/store.mjs';
import {ORIGINAL_STUDY,STUDY_CASE_REVIEWERS,loadStudyExtractionInputs,bindStudyExtractionCase,
  studyCaseAnswers,studyExtractionDefinition,studyCaseTableDefinition} from './study-extraction-case.mjs';

export const STUDY_WORKFLOW_SCHEMA='sf88-study-extraction-receiving-workflow/v1';
const MAX_SOURCE=64*1024*1024,MAX_PORTABLE=256*1024*1024;
const same=(left,right)=>extractionDigest(left)===extractionDigest(right);
const clone=value=>structuredClone(value);
const reviewerA=STUDY_CASE_REVIEWERS[0],reviewerB=STUDY_CASE_REVIEWERS[1],resolver=STUDY_CASE_REVIEWERS[2];
const absolute=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value;
const exists=async file=>{try{const value=await lstat(file);need(value.isFile()&&!value.isSymbolicLink(),'STUDY_WORKFLOW_FILE_INVALID');return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}};
const optionalJson=async file=>await exists(file)?readJson(file,MAX_SOURCE):null;
async function immutable(file,body){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);
  if(await exists(file)){const saved=await readBytes(file,MAX_PORTABLE);
    need(saved.length===bytes.length&&digest(saved)===digest(bytes),'STUDY_WORKFLOW_ARTIFACT_CHANGED');return;}
  try{await writeBytes(file,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;const saved=await readBytes(file,MAX_PORTABLE);
    need(saved.length===bytes.length&&digest(saved)===digest(bytes),'STUDY_WORKFLOW_ARTIFACT_CHANGED');}
}
async function immutableJson(file,value){return immutable(file,jsonBytes(value));}
async function identity(file){const bytes=await readResearchHostFile(file,MAX_PORTABLE);return {file,bytes:bytes.length,sha256:digest(bytes)};}
async function checkpoint(file,produce){
  const saved=await optionalJson(file);if(saved)return saved;
  const value=await produce();await immutableJson(file,value);return value;
}

/** Persist the exact original action before calling the maintained Store.
 * Re-entering a completed step invokes that same request; the Store recovers
 * its original result even when later work has advanced the dossier.
 */
function steps({store,dossierId,operation,directory}){
  return async function step(name,method,{actor=resolver,action,data,reviewId}){
    need(/^[a-z0-9][a-z0-9-]{0,90}$/.test(name),'STUDY_WORKFLOW_STEP_NAME_INVALID');
    need(['reviewEligibility','reviewExtraction','reviewExtractionPublication'].includes(method),
      'STUDY_WORKFLOW_METHOD_INVALID');
    const file=join(directory,name+'.request.json'),prior=await optionalJson(file);
    const requestId='sxw_'+digest(jsonBytes({operation,name})).slice(0,60);
    const normalize={reviewEligibility:eligibilityInput,reviewExtraction:extractionInput,
      reviewExtractionPublication:publicationInput}[method];
    const expectedRevision=prior?.expectedRevision??(await store.getMetadata(dossierId)).revision;
    const request=normalize({requestId,expectedRevision,actor,action,data,...(reviewId?{reviewId}:{})});
    if(prior)need(same(prior,request),'STUDY_WORKFLOW_REQUEST_INPUT_CHANGED');
    else await immutableJson(file,request);
    const reply=await store[method](dossierId,{...request,projection:'metadata'});
    need(reply?.dossier?.id===dossierId&&reply.operation?.requestId===request.requestId&&
      same(reply.operation.request,request)&&reply.operation.action===action,'STUDY_WORKFLOW_OPERATION_CHANGED');
    return {schema:STUDY_WORKFLOW_SCHEMA,operation,dossierId,requestFile:file,
      requestSha256:extractionDigest(request),requestFileSha256:digest(jsonBytes(request)),operationId:reply.operation.id,revision:reply.operation.revision,
      result:clone(reply.operation.result),duplicate:reply.duplicate,request};
  };
}
async function allPages(store,method,id,options={}){
  let revision=options.revision,offset=0;const items=[];
  while(true){
    const page=await store[method](id,{...options,...(revision===undefined?{}:{revision}),offset,limit:30});
    const pageId=page.dossierId??page.dossier?.id,pageRevision=page.revision??page.dossier?.revision;
    need(pageId===id&&Number.isSafeInteger(pageRevision)&&Array.isArray(page.items)&&
      (page.dossierId===undefined||page.dossierId===pageId)&&
      (page.dossier===undefined||page.dossier.id===pageId&&page.dossier.revision===pageRevision)&&
      (page.revision===undefined||page.revision===pageRevision),'STUDY_WORKFLOW_PAGE_INVALID');
    if(revision===undefined)revision=pageRevision;
    need(pageRevision===revision&&page.offset===offset,'STUDY_WORKFLOW_PAGE_REVISION_CHANGED');
    items.push(...page.items);
    if(page.nextOffset===null){need(items.length===page.total,'STUDY_WORKFLOW_PAGE_POPULATION_CHANGED');return {revision,items};}
    need(Number.isSafeInteger(page.nextOffset)&&page.nextOffset>offset,'STUDY_WORKFLOW_CURSOR_INVALID');
    offset=page.nextOffset;
  }
}
async function siblingState(store,id,questionId,revision){
  const view=await store.get(id,{revision,references:false,includeHistory:false});
  const question=view.questions.find(value=>value.id===questionId);need(question,'STUDY_WORKFLOW_SIBLING_REQUIRED');
  return {question:clone(question),editions:view.editions.filter(value=>value.questionId===questionId),
    findings:view.findings.filter(value=>value.questionId===questionId),
    citations:view.sources.flatMap(source=>source.citations.filter(value=>value.questionId===questionId))};
}
function eligibilityProtocol(){
  return {name:'Original registry result commissioning',
    criteria:[{id:'original-registry-results',name:'Original registry result record',
      include:'The retained NCT03529110 registry record provides posted outcome measurements with original group and population context.',
      exclude:'The retained source is a different study or has no posted outcome measurement objects.'}],
    stages:[{id:'registry-review',name:'Original registry review',criterionIds:['original-registry-results'],
      reviewerIds:[reviewerA.id,reviewerB.id],minimumDecisions:2,requireFullText:false}],
    reviewers:clone(STUDY_CASE_REVIEWERS),resolverIds:[resolver.id],
    exclusionReasons:[{id:'outside-original-source',label:'Outside the selected original registry result source'}],
    disagreementProcedure:'Each reviewer records an independent source decision. The resolver uses all current decisions and the exact retained registry record.'};
}
async function seed({store,operation,runDirectory,inputs}){
  const file=join(runDirectory,'seed.json'),saved=await optionalJson(file);
  if(saved){
    need(saved.schema===STUDY_WORKFLOW_SCHEMA&&saved.operation===operation&&
      saved.sourceSha256===ORIGINAL_STUDY.sha256,'STUDY_WORKFLOW_SEED_CHANGED');
    need((await store.getMetadata(saved.dossierId,{revision:saved.originalRevision})).revision===saved.originalRevision,
      'STUDY_WORKFLOW_SEED_REVISION_CHANGED');return saved;
  }
  const title='Original study result commissioning / '+operation;
  const matches=(await store.list()).filter(value=>value.title===title);
  need(matches.length<=1,'STUDY_WORKFLOW_DOSSIER_AMBIGUOUS');
  let metadata=matches.length?await store.getMetadata(matches[0].id):
    await store.create({title,description:'Complete original NCT03529110 result review, published evidence and continued receiving.',
      projection:'metadata'});
  const dossierId=metadata.id,texts=[
    'Which values, confidence bounds, populations and denominator scopes are reported in the original NCT03529110 outcome record?',
    'Which original registry context should remain available for the related research question?'
  ],questionIds=[];
  for(const text of texts){
    let questions=metadata.questions.filter(value=>value.text===text);
    need(questions.length<=1,'STUDY_WORKFLOW_QUESTION_AMBIGUOUS');
    if(!questions.length){metadata=await store.addQuestion(dossierId,{text,expectedRevision:metadata.revision,projection:'metadata'});
      questions=metadata.questions.filter(value=>value.text===text);}
    const questionId=questions[0].id;questionIds.push(questionId);
    metadata=await store.receiveSourceBundle(dossierId,{questionId,rawBytes:inputs.bundle.bytes,
      expectedBundleSha256:inputs.bundle.preview.bundleSha256,expectedRevision:metadata.revision,projection:'metadata'});
  }
  const occurrences=await allPages(store,'eligibility',dossierId,{revision:metadata.revision,section:'occurrences'});
  const selected=occurrences.items.filter(value=>value.questionId===questionIds[0]&&value.sourceSha256===inputs.bundle.preview.bundleSha256);
  need(selected.length===1,'STUDY_WORKFLOW_ORIGINAL_OCCURRENCE_AMBIGUOUS');
  const occurrenceId=selected[0].occurrenceId,questionId=questionIds[0];
  const requests=await privateDirectory(join(runDirectory,'requests','seed'));
  const step=steps({store,dossierId,operation:operation+'-seed',directory:requests});
  const reviewed=await step('create-review','reviewEligibility',{actor:resolver,action:'create-review',data:{
    questionId,name:'Original NCT03529110 registry source review',description:'Question-specific original result source selection.',
    protocol:eligibilityProtocol()}});
  const reviewId=reviewed.result.review.id,protocolId=reviewed.result.protocol.id;
  const work=await step('create-workset','reviewEligibility',{action:'create-workset',reviewId,data:{
    protocolId,name:'Original posted registry record',occurrenceIds:[occurrenceId],
    reason:'Review the exact retained original study occurrence for this question.'}});
  const workSetId=work.result.workSet.id,decisions=[];
  for(const [index,actor]of [reviewerA,reviewerB].entries()){
    const decision=await step('reviewer-'+(index+1),'reviewEligibility',{actor,action:'decide',reviewId,data:{
      workSetId,occurrenceId,stageId:'registry-review',disposition:'include',
      criterionAnswers:[{criterionId:'original-registry-results',assessment:'meets',
        note:'The original registry identifies NCT03529110 and retains all fourteen outcome measurement objects.'}],
      basis:{availability:'available',occurrenceIds:[occurrenceId],
        locator:ORIGINAL_STUDY.fileName+'#/protocolSection/identificationModule/nctId and #/resultsSection/outcomeMeasuresModule/outcomeMeasures',
        note:'Exact original study bytes and original capture provenance accompany the retained source.'},
      reason:'The selected registry result record satisfies the stated commissioning source criterion.'}});
    decisions.push(decision.result.decision.id);
  }
  const resolution=await step('resolve-registry-source','reviewEligibility',{action:'resolve',reviewId,data:{
    workSetId,occurrenceId,stageId:'registry-review',mode:'consensus',disposition:'include',decisionIds:decisions,
    reason:'Both current decisions identify the same original registry source and posted result population.'}});
  await step('apply-registry-source','reviewEligibility',{action:'apply-outcomes',reviewId,data:{
    workSetId,outcomes:[{occurrenceId,resolutionId:resolution.result.resolution.id,classification:'background',
      note:'Original registry outcome record selected for complete result extraction.'}],
    reason:'Apply this final decision to the selected question occurrence.'}});
  const linked=await step('link-original-study','reviewEligibility',{action:'study-link',reviewId,data:{
    name:'NCT03529110 / DESTINY-Breast03',occurrenceIds:[occurrenceId],
    evidence:[{occurrenceId,locator:ORIGINAL_STUDY.fileName+'#/protocolSection/identificationModule/nctId',
      note:'The original registry record explicitly identifies NCT03529110; its original capture and complete study remain retained.'}],
    reason:'Bind the complete result extraction to this explicit original study/report identity.'}});
  metadata=await store.getMetadata(dossierId);
  const result={schema:STUDY_WORKFLOW_SCHEMA,operation,dossierId,questionId,siblingQuestionId:questionIds[1],occurrenceId,
    studyId:linked.result.study.id,studyVersion:linked.result.study.version,reviewId,workSetId,
    sourceSha256:ORIGINAL_STUDY.sha256,bundleSha256:inputs.bundle.preview.bundleSha256,
    originalRevision:metadata.revision,sibling:await siblingState(store,dossierId,questionIds[1],metadata.revision)};
  await immutableJson(file,result);return result;
}
async function inspectResultSet(store,id,resultSetId,sourceCase,revision,{discrepancy=true}={}){
  const {revision:selected,items}=await allPages(store,'extraction',id,{revision,resultSetId,section:'results'});
  const current=items.filter(value=>value.current);
  need(current.length===sourceCase.rows.length&&current.every(value=>value.status==='RESOLVED'),
    'STUDY_WORKFLOW_COMPLETE_RESULTS_REQUIRED');
  const expected=new Map(sourceCase.answers.map(value=>[value.rowId+'\n'+value.fieldId,value]));
  for(const row of sourceCase.rows){
    const matches=current.filter(value=>value.record?.row?.id===row.id);
    need(matches.length===1,'STUDY_WORKFLOW_RESULT_ROW_CHANGED');
    const result=matches[0];
    need(result.questionId===sourceCase.questionId&&same(result.record.row.context,row.context)&&
      result.record.row.sources.some(value=>value.occurrenceId===sourceCase.occurrenceId),'STUDY_WORKFLOW_RESULT_SOURCE_CHANGED');
    const submissions=result.record.submissions;
    need(submissions.length===2&&[reviewerA.id,reviewerB.id].every(actor=>submissions.some(value=>value.actor.id===actor)),
      'STUDY_WORKFLOW_INDEPENDENT_SUBMISSIONS_REQUIRED');
    for(const field of sourceCase.definition.fields){
      const value=result.record.values?.[field.id],answer=expected.get(row.id+'\n'+field.id);
      need(value&&value.status===answer.status&&same(value.value,answer.value)&&same(value.context,answer.context),
        'STUDY_WORKFLOW_REVIEWED_VALUE_CHANGED');
      need(value.bases.some(basis=>basis.occurrenceId===sourceCase.occurrenceId&&
        basis.pointer===answer.bases[0].pointer&&basis.file?.name===ORIGINAL_STUDY.fileName&&
        basis.contentSha256===ORIGINAL_STUDY.sha256&&basis.contentBytes===ORIGINAL_STUDY.bytes),
        'STUDY_WORKFLOW_REVIEWED_BASIS_CHANGED');
    }
    if(discrepancy&&row.id===sourceCase.disagreement.rowId){
      const original=submissions.find(value=>value.actor.id===reviewerA.id).values[sourceCase.disagreement.fieldId];
      const entered=submissions.find(value=>value.actor.id===reviewerB.id).values[sourceCase.disagreement.fieldId];
      need(same(original.value,sourceCase.disagreement.originalValue)&&same(entered.value,sourceCase.disagreement.enteredValue)&&
        entered.sourceDifferences.some(value=>same(value.reported,sourceCase.disagreement.originalValue)&&
          same(value.entered,sourceCase.disagreement.enteredValue))&&result.record.resolution.mode==='adjudication',
        'STUDY_WORKFLOW_DISCREPANCY_HISTORY_REQUIRED');
    }
  }
  return {revision:selected,current,history:items,
    summary:{resultSetId,currentResults:current.length,historicalResultEditions:items.length,
      resolvedRows:current.map(value=>({resultId:value.resultId,editionId:value.editionId,rowId:value.record.row.id,status:value.status}))}};
}

async function publishTable({store,id,sourceCase,selection,step,edition,previous}){
  need((edition===1&&!previous)||(edition===2&&previous?.tableId),'STUDY_WORKFLOW_TABLE_EDITION_INVALID');
  const definition=publicationDefinition(studyCaseTableDefinition(sourceCase.questionId,{edition}));
  const authored=edition===1?
    await step('create-complete-table','reviewExtractionPublication',{action:'create-table',data:{definition}}):
    await step('revise-complete-table','reviewExtractionPublication',{action:'revise-table',data:{
      tableId:previous.tableId,expectedTableEditionId:previous.tableEditionId,definition,
      reason:'Keep the complete fourteen-row evidence table and add the explicit original denominator context to the next customer edition.'}});
  const tableEdition=authored.result.tableEdition,tableId=tableEdition.tableId;
  need(tableEdition.edition===edition&&same(tableEdition.definition,definition)&&
    (edition===1||tableId===previous.tableId),'STUDY_WORKFLOW_TABLE_DEFINITION_CHANGED');
  const checked=await inspectResultSet(store,id,selection.resultSetId,sourceCase,undefined,{discrepancy:edition===1});
  const available=await allPages(store,'extractionPublications',id,{revision:checked.revision,tableId,section:'results',currentOnly:true});
  const selected=[];
  for(const row of sourceCase.rows){
    const matches=available.items.filter(value=>value.current&&value.record?.resultSet?.id===selection.resultSetId&&
      value.record?.row?.id===row.id);
    need(matches.length===1&&matches[0].status==='RESOLVED'&&/^[a-f0-9]{64}$/.test(matches[0].fingerprint),
      'STUDY_WORKFLOW_PUBLICATION_RESULT_REQUIRED');
    const value=matches[0],core=checked.current.find(item=>item.resultId===value.resultId);
    const {fingerprint,...original}=value;
    need(core&&same(core,original),'STUDY_WORKFLOW_PUBLICATION_DESCRIPTOR_CHANGED');
    selected.push({resultId:value.resultId,editionId:value.editionId,fingerprint});
  }
  const context=await store.extractionPublications(id,{revision:available.revision,tableId,section:'overview'});
  need(context.reviewContext?.dossierId===id&&/^[a-f0-9]{64}$/.test(context.reviewContext.fingerprint),
    'STUDY_WORKFLOW_PUBLICATION_CONTEXT_REQUIRED');
  const published=await step('publish-complete-table-v'+edition,'reviewExtractionPublication',{action:'publish-table',data:{
    tableId,tableEditionId:tableEdition.id,previousPublicationId:previous?.publicationId??null,rows:selected,
    title:'NCT03529110 complete reported outcomes / edition '+edition,
    summary:'All fourteen original outcome measurements across five outcomes, with independent complete field reviews, resolved source values, confidence bounds, analysis populations and each original denominator scope.',
    limitations:'The table preserves the posted registry representation and its original data cut-off. NA remains an original non-estimable value, absent fields remain explicitly not reported, and original comments and analysis structures remain attached to every selected result. Review editions change the operator instructions and delivery presentation; the retained original study source stays identical.',
    reason:edition===1?'Publish the complete source-bound baseline after resolving both independent submissions.':
      'Publish the complete receiving continuation and retain its relationship to the original customer baseline.',
    review:{contextFingerprint:context.reviewContext.fingerprint,
      note:edition===1?'Reviewed all fourteen current resolved original rows and all 182 fields. The BICR response entry disagreement is resolved against the retained 79.7 source string; both submitted entries remain in the frozen descriptors.':
        'Reviewed all fourteen current resolved receiving rows and their full original values and scopes. The current form and table add explicit denominator review context; the prior source, forms, submissions, resolution and publication remain available.'}}});
  const publication=published.result.publication;
  need(publication.tableId===tableId&&publication.tableEditionId===tableEdition.id&&publication.edition===edition&&
    publication.previousPublicationId===(previous?.publicationId??null)&&publication.rows.length===sourceCase.rows.length&&
    same(publication.definition,definition),'STUDY_WORKFLOW_COMPLETE_PUBLICATION_CHANGED');
  for(const [index,row]of publication.rows.entries()){
    const expected=selected[index];
    need(row.currentAtPublication===true&&row.result.resultId===expected.resultId&&row.result.editionId===expected.editionId&&
      row.fingerprint===expected.fingerprint&&row.result.record.resultSet.id===selection.resultSetId&&
      row.result.status==='RESOLVED'&&row.cells.length===definition.columns.length,
      'STUDY_WORKFLOW_PUBLISHED_ROW_CHANGED');
  }
  const {sha256,...body}=publication;
  need(sha256===extractionDigest(body),'STUDY_WORKFLOW_PUBLICATION_SHA_CHANGED');
  return {...selection,tableId,tableEditionId:tableEdition.id,publicationId:publication.id,
    publicationSha256:sha256,publicationRevision:published.revision,currentRevision:published.revision,
    publicationRequestFile:published.requestFile,publicationOperationId:published.operationId};
}
async function reviewPublicationImpacts({store,id,selection,step,label,reason}){
  const view=await allPages(store,'extractionPublications',id,{tableId:selection.tableId,
    publicationId:selection.publicationId,section:'impact'});
  const reviewed=[];
  for(const impact of view.items){
    need(impact.publicationId===selection.publicationId&&
      ['table-definition','core:form-edition','core:revised-result-set'].includes(impact.kind),
      'STUDY_WORKFLOW_PUBLICATION_SOURCE_CHANGE_REQUIRES_REVIEW');
    if(impact.review?.fingerprint===impact.fingerprint&&impact.review.disposition==='reviewed'){
      reviewed.push(impact.review.id);continue;
    }
    const name=label+'-impact-'+extractionDigest({id:impact.id,fingerprint:impact.fingerprint}).slice(0,20);
    const result=await step(name,'reviewExtractionPublication',{action:'review-impact',data:{
      publicationId:selection.publicationId,impactId:impact.id,fingerprint:impact.fingerprint,
      disposition:'reviewed',reason}});
    reviewed.push(result.result.impactReview.id);
  }
  return reviewed;
}


async function reviseForm({store,id,sourceCase,selection,step}){
  const editions=await allPages(store,'extraction',id,{formId:selection.formId,section:'formEditions'});
  const original=editions.items.find(value=>value.id===selection.formEditionId);
  need(original&&same(original.definition,extractionDefinition(studyExtractionDefinition())),'STUDY_WORKFLOW_ORIGINAL_FORM_CHANGED');
  const revised=await step('prepare-form-v2','reviewExtraction',{action:'revise-form',data:{
    formId:selection.formId,previousEditionId:selection.formEditionId,
    name:original.name,description:original.description,
    definition:studyExtractionDefinition({edition:2}),
    reason:'Carry the complete original field set into the next review edition with explicit group and denominator-scope instructions.'}});
  const impacts=await allPages(store,'extraction',id,{resultSetId:selection.resultSetId,section:'impact'});
  for(const [index,impact]of impacts.items.entries()){
    await step('retain-baseline-impact-'+index,'reviewExtraction',{action:'review-impact',data:{
      impactId:impact.id,expectedFingerprint:impact.fingerprint,disposition:'retain',
      reason:'The completed baseline remains bound to form v1 and the original registry source. Form v2 is prepared for the continued receiving review.'}});
  }
  return revised.result.formEdition;
}
async function continueInReceiving({store,id,seed:originalSeed,sourceCase,selection,formEdition,step}){
  const created=await step('create-v2-result-set','reviewExtraction',{action:'create-result-set',data:{
    formEditionId:formEdition.id,studyId:originalSeed.studyId,studyVersion:originalSeed.studyVersion,
    name:'NCT03529110 complete received review / form v2',
    description:'Continue the complete original result population in the receiving installation.',
    rows:clone(sourceCase.rows),reason:'Continue reviewing all fourteen original rows in this received copy using the current form edition.',
    supersedes:selection.resultSetId}});
  const resultSetId=created.result.resultSet.id,submissionIds=[];
  let replay;
  for(const [index,actor]of [reviewerA,reviewerB].entries()){
    const draft=await step('v2-extractor-'+(index+1),'reviewExtraction',{actor,action:'save-extraction',data:{
      resultSetId,answers:studyCaseAnswers(sourceCase),
      reason:index===0?'First complete review in the receiving installation.':
        'Independent receiving review; the earlier operator entry is now entered from its original registry field.'}});
    const submitted=await step('v2-submit-'+(index+1),'reviewExtraction',{actor,action:'submit-extraction',data:{
      extractionId:draft.result.extraction.id,
      reason:'Submit the complete received review with all original source-bound fields.'}});
    submissionIds.push(submitted.result.submission.id);replay=submitted;
  }
  for(const [index,row]of sourceCase.rows.entries()){
    await step('v2-resolve-row-'+index,'reviewExtraction',{action:'resolve-result',data:{
      resultSetId,rowId:row.id,submissionIds,mode:'consensus',
      reason:'Both current receiving submissions agree with the retained original registry values, bounds and denominator scope.'}});
  }
  const impacts=await allPages(store,'extraction',id,{resultSetId:selection.resultSetId,section:'impact'});
  for(const [index,impact]of impacts.items.entries()){
    await step('v2-review-replaced-impact-'+index,'reviewExtraction',{action:'review-impact',data:{
      impactId:impact.id,expectedFingerprint:impact.fingerprint,disposition:'replaced',resultSetId,
      reason:'The complete received form-v2 result set supersedes the earlier set while preserving every original form, submission and resolution.'}});
  }
  const complete=await inspectResultSet(store,id,resultSetId,sourceCase,undefined,{discrepancy:false});
  return {formId:selection.formId,formEditionId:formEdition.id,resultSetId,originalRevision:created.revision-1,
    reviewedRevision:complete.revision,currentRevision:complete.revision,submissionIds,
    reviewRequest:replay.request,reviewRequestFile:replay.requestFile,summary:complete.summary};
}
async function saveDossierReports({store,id,revision,directory,label}){
  const artifacts=[];
  for(const format of ['md','html']){
    const result=await store.exportDossier(id,{revision,format});
    need(result.revision===revision,'STUDY_WORKFLOW_REPORT_REVISION_CHANGED');
    const file=join(directory,label+'-r'+revision+'.'+format);
    await immutable(file,Buffer.from(result.body));
    artifacts.push({...await identity(file),kind:'dossier-report',format,revision});
  }
  return artifacts;
}
async function savePortable({store,id,revision,file,compression}){
  if(!(await exists(file)))await writePortableFile(file,await store.exportStream(id,{revision,compression}));
  return {...await identity(file),kind:'portable',revision,format:compression==='gzip'?'json.gz':'json'};
}
async function reopen({store,file,format}){
  if(format==='json')return store.reopen(JSON.parse((await readBytes(file,MAX_PORTABLE)).toString('utf8')));
  return store.reopenStream(await openPortableFile(file),{projection:'metadata'});
}
async function verifyReceiving({original,received,id,revision,sourceCase,selections,sibling}){
  const left=await original.getMetadata(id,{revision}),right=await received.getMetadata(id,{revision});
  need(same(left,right),'STUDY_WORKFLOW_RECEIVING_METADATA_CHANGED');
  need(same(await siblingState(received,id,sibling.question.id,revision),sibling),'STUDY_WORKFLOW_SIBLING_CHANGED');
  const sources=[];
  for(const edition of left.editions.filter(value=>value.mode==='retained')){
    const a=await original.readRetainedEdition(id,edition.id,{revision});
    const b=await received.readRetainedEdition(id,edition.id,{revision});
    need(a.bytes.equals(b.bytes),'STUDY_WORKFLOW_RECEIVING_SOURCE_CHANGED');
    sources.push({editionId:edition.id,bytes:b.bytes.length,sha256:digest(b.bytes)});
  }
  for(const selection of selections){
    for(const section of ['forms','formEditions','resultSets','extractions','submissions','results','resolutions','impact','operations']){
      const options={revision,resultSetId:selection.resultSetId,section};
      if(['forms','formEditions'].includes(section)){delete options.resultSetId;options.formId=selection.formId;}
      const a=await allPages(original,'extraction',id,options),b=await allPages(received,'extraction',id,options);
      need(same(a,b),'STUDY_WORKFLOW_RECEIVING_REVIEW_CHANGED');
    }
    for(const section of ['tables','table-editions','results','publications','rows','impact','reviews','withdrawals','operations']){
      const options={revision,tableId:selection.tableId,section};
      const a=await allPages(original,'extractionPublications',id,options);
      const b=await allPages(received,'extractionPublications',id,options);
      need(same(a,b),'STUDY_WORKFLOW_RECEIVING_PUBLICATION_CHANGED');
    }
    for(const format of ['json','csv','md','html']){
      const options={revision,tableId:selection.tableId,publicationId:selection.publicationId,format};
      const a=await original.exportExtractionPublication(id,options),b=await received.exportExtractionPublication(id,options);
      need(Buffer.from(a.body).equals(Buffer.from(b.body)),'STUDY_WORKFLOW_RECEIVING_TABLE_CHANGED');
    }
  }
  for(const format of ['md','html']){
    const a=await original.exportDossier(id,{revision,format}),b=await received.exportDossier(id,{revision,format});
    need(Buffer.from(a.body).equals(Buffer.from(b.body)),'STUDY_WORKFLOW_RECEIVING_REPORT_CHANGED');
  }
  const pointers=[...new Set(sourceCase.answers.flatMap(answer=>answer.bases.map(value=>value.pointer)))];
  const options={revision,occurrenceId:sourceCase.occurrenceId,fileName:ORIGINAL_STUDY.fileName,pointers};
  const a=await original.extractionSourceValues(id,options),b=await received.extractionSourceValues(id,options);
  need(same(a,b),'STUDY_WORKFLOW_RECEIVING_SOURCE_VALUES_CHANGED');
  return {dossierId:id,revision,sources,formIds:[...new Set(selections.map(value=>value.formId))],
    resultSetIds:selections.map(value=>value.resultSetId),publicationIds:selections.map(value=>value.publicationId),
    originalStudySha256:ORIGINAL_STUDY.sha256,sourcePointers:pointers.length};
}
async function openApp(directory,connectionFile){
  const previous=await optionalJson(connectionFile);
  if(previous)need(previous.directory===directory,'STUDY_WORKFLOW_CONNECTION_DIRECTORY_CHANGED');
  const app=await startDossierWorkspace({directory,port:previous?Number(new URL(previous.url).port):0});
  try{await writeJson(connectionFile,{schema:'stellar-forge.research-workspace-connection.v1',
    mode:'RESEARCH_DOSSIER_WORKSPACE',directory,url:app.url,workspaceId:app.workspaceId,instanceId:app.instanceId});
    return app;
  }catch(error){await app.close();throw error;}
}
function safeArtifactPath(root,file){
  need(typeof file==='string'&&file.length>0,'STUDY_WORKFLOW_ARTIFACT_PATH_REQUIRED');
  const absolutePath=isAbsolute(file)?file:resolve(root,file),local=relative(root,absolutePath);
  need(local&&!isAbsolute(local)&&!local.split(sep).some(value=>!value||value==='..'||value==='.')&&
    !local.split(sep).some(value=>/^(?:(?:.*-)?connection(?:\.private)?\.json|input\.private\.json|.*browser-profile|workspace|reopened-json|reopened-gzip|received-workspace|final-received-workspace)$/.test(value)),
    'STUDY_WORKFLOW_PRIVATE_ARTIFACT_REFUSED');
  return absolutePath;
}
async function screenshots(result,root){
  const values=[];
  for(const output of result?.nativeOutputs??[]){
    const raw=typeof output==='string'?output:output.file??output.path??output.filename;
    if(typeof raw!=='string'||!raw.toLowerCase().endsWith('.png'))continue;
    const file=safeArtifactPath(root,raw),value=await identity(file);
    if(object(output))need((output.sha256===undefined||output.sha256===value.sha256)&&
      (output.bytes===undefined||output.bytes===value.bytes),'STUDY_WORKFLOW_BROWSER_ARTIFACT_CHANGED');
    values.push({...value,kind:'browser-screenshot'});
  }
  return values;
}
async function verifiedDeliveryArtifacts(result,root,kind){
  need(object(result)&&Array.isArray(result.files),'STUDY_WORKFLOW_DELIVERY_FILES_REQUIRED');
  const output=[];
  for(const descriptor of result.files){
    const file=safeArtifactPath(root,descriptor.file),actual=await identity(file);
    need(actual.bytes===descriptor.bytes&&actual.sha256===descriptor.sha256,'STUDY_WORKFLOW_DELIVERY_FILE_CHANGED');
    output.push({...actual,kind,...(descriptor.contentType?{contentType:descriptor.contentType}:{})});
  }
  if(result.journalFile){
    const file=safeArtifactPath(root,result.journalFile);
    output.push({...await identity(file),kind:'merchant-operation-history'});
  }
  return output;
}
function deliveryReference(root,descriptor){
  return {file:relative(root,safeArtifactPath(root,descriptor.file)).split(sep).join('/'),
    bytes:descriptor.bytes,sha256:descriptor.sha256,...(descriptor.contentType?{contentType:descriptor.contentType}:{})};
}
function merchantRecord(value,root){
  need(value.schema==='sf88-research-study-extraction-merchant-receiving/v1'&&value.state==='COMPLETED',
    'STUDY_WORKFLOW_MERCHANT_COMPLETION_REQUIRED');
  return {schema:value.schema,state:value.state,workspaceId:value.workspaceId,dossierId:value.dossierId,revision:value.revision,
    formId:value.formId,resultSetId:value.resultSetId,tableId:value.tableId,publicationId:value.publicationId,
    ...(value.againstPublicationId?{againstPublicationId:value.againstPublicationId}:{}),
    source:{occurrenceId:value.source.occurrenceId,fileName:value.source.fileName,sha256:value.source.sha256,
      bytes:value.source.bytes,pointerCount:value.source.pointerCount},
    pages:Object.fromEntries(Object.entries(value.pages).map(([family,sections])=>[family,
      Object.fromEntries(Object.entries(sections).map(([name,item])=>[name,{
        section:item.section,count:item.count,...(item.state?{state:item.state}:{}),
        pageCount:item.pages.length}]))])),
    replays:value.replays.map(item=>({kind:item.kind,requestId:item.requestId,operationId:item.operationId,
      revision:item.revision,duplicate:item.duplicate,requestFile:deliveryReference(root,item.requestFile),
      responseFile:deliveryReference(root,item.responseFile)})),
    exports:value.exports.map(item=>({kind:item.kind,exportId:item.exportId,selection:item.selection,
      file:deliveryReference(root,item.file),receiptFile:deliveryReference(root,item.receiptFile)})),
    files:value.files.map(item=>deliveryReference(root,item)),
    journalFile:relative(root,safeArtifactPath(root,value.journalFile)).split(sep).join('/'),completedAt:value.completedAt};
}
function eligibilityRecord(value,root){
  need(value.schema==='sf88-study-extraction-eligibility-receiving/v1'&&value.state==='COMPLETE',
    'STUDY_WORKFLOW_CUSTOMER_COMPLETION_REQUIRED');
  return {schema:value.schema,state:value.state,workspaceId:value.workspaceId,dossierId:value.dossierId,
    reviewId:value.reviewId,workSetId:value.workSetId,revision:value.revision,replay:clone(value.replay),
    files:value.files.map(item=>deliveryReference(root,item)),archive:deliveryReference(root,value.archive),
    selectionFile:deliveryReference(root,value.selectionFile),
    receiving:Object.fromEntries(Object.entries(value.receiving).map(([name,item])=>[name,
      Object.fromEntries(Object.entries(item).filter(([key])=>!['directory','currentRevision'].includes(key)))]))};
}
async function completeResult({runDirectory,binding,seed:originalSeed,selection,receivedSelection,artifacts,
  jsonReceiving,gzipReceiving,continuedReceiving,senderBrowser,receivedBrowser,merchant,receivedMerchant,eligibility}){
  const unique=new Map();
  for(const value of artifacts){
    const file=safeArtifactPath(runDirectory,value.file),path=relative(runDirectory,file).split(sep).join('/');
    const artifact={...value,file:path},prior=unique.get(path);
    need(!prior||prior.sha256===artifact.sha256&&prior.bytes===artifact.bytes,'STUDY_WORKFLOW_ARTIFACT_CHANGED');
    unique.set(path,artifact);
  }
  const rowLineage=selection.summary.resolvedRows.map(before=>{
    const after=receivedSelection.summary.resolvedRows.find(value=>value.rowId===before.rowId);
    need(after,'STUDY_WORKFLOW_RECEIVED_ROW_LINEAGE_REQUIRED');
    return {sourceRowId:before.rowId,previous:{resultId:before.resultId,editionId:before.editionId},
      current:{resultId:after.resultId,editionId:after.editionId}};
  });
  const result={schema:STUDY_WORKFLOW_SCHEMA,state:'COMPLETE',binding,seed:originalSeed,selection,receivedSelection,rowLineage,
    jsonReceiving,gzipReceiving,continuedReceiving,
    browser:{sender:senderBrowser.selection??selection,received:receivedBrowser.selection??receivedSelection},
    customer:eligibilityRecord(eligibility,runDirectory),
    merchant:{sender:merchantRecord(merchant,runDirectory),received:merchantRecord(receivedMerchant,runDirectory)},
    artifacts:[...unique.values()],completedAt:new Date().toISOString()};
  await immutableJson(join(runDirectory,'result.json'),result);return result;
}


async function replaySelection(store,id,selection,method){
  const file=selection.reviewRequestFile;
  need(absolute(file),'STUDY_WORKFLOW_NATIVE_REQUEST_FILE_REQUIRED');
  const bytes=await readResearchHostFile(file,MAX_SOURCE),request=JSON.parse(bytes.toString('utf8'));
  need(object(request)&&Object.keys(request).every(key=>['requestId','expectedRevision','actor','action','data'].includes(key)),
    'STUDY_WORKFLOW_CANONICAL_REQUEST_REQUIRED');
  const before=(await store.getMetadata(id)).revision;
  const result=await store[method](id,{...request,projection:'metadata'});
  need(result.duplicate===true&&same(result.operation.request,request)&&
    (await store.getMetadata(id)).revision===before,'STUDY_WORKFLOW_REPLAY_CREATED_REVISION');
  return {kind:method==='reviewExtraction'?'extraction':'publication',file,sha256:digest(bytes),operationId:result.operation.id};
}
async function saveExtractionReports({store,id,selection,revision,directory,label}){
  const artifacts=[];
  for(const format of ['json','md','html']){
    const exported=await store.exportExtraction(id,{revision,formId:selection.formId,resultSetId:selection.resultSetId,format});
    need(exported.revision===revision,'STUDY_WORKFLOW_EXTRACTION_EXPORT_REVISION_CHANGED');
    const file=join(directory,label+'-extraction-r'+revision+'.'+format);
    await immutable(file,Buffer.from(exported.body));artifacts.push({...await identity(file),kind:'extraction-report',format,revision});
  }
  return artifacts;
}
async function saveTableExports({store,id,selection,revision,directory,label,againstPublicationId}){
  const artifacts=[];
  for(const format of ['json','csv','md','html']){
    const options={revision,tableId:selection.tableId,publicationId:selection.publicationId,format,
      ...(againstPublicationId?{againstPublicationId}:{})};
    const exported=await store.exportExtractionPublication(id,options);
    need(exported.revision===revision,'STUDY_WORKFLOW_TABLE_EXPORT_REVISION_CHANGED');
    const file=join(directory,label+'-table-r'+revision+(againstPublicationId?'-comparison':'')+'.'+format);
    await immutable(file,Buffer.from(exported.body));artifacts.push({...await identity(file),kind:againstPublicationId?
      'table-comparison':'table-publication',format,revision,publicationId:selection.publicationId,
      ...(againstPublicationId?{againstPublicationId}:{})});
  }
  return artifacts;
}
function merchantSource(sourceCase){
  return {occurrenceId:sourceCase.occurrenceId,fileName:ORIGINAL_STUDY.fileName,
    pointers:[...new Set(sourceCase.answers.flatMap(answer=>answer.bases.map(value=>value.pointer)))],
    sha256:ORIGINAL_STUDY.sha256,bytes:ORIGINAL_STUDY.bytes};
}
async function runHeld(options,drivers){
  const {operation,runDirectory,playwrightModule,chromiumExecutable}=options;
  const inputs=await loadStudyExtractionInputs(options);
  const binding={schema:STUDY_WORKFLOW_SCHEMA,operation,source:clone(ORIGINAL_STUDY),
    sourceBundleSha256:inputs.bundle.preview.bundleSha256};
  const inputFile=join(runDirectory,'input.json'),existingBinding=await optionalJson(inputFile);
  if(existingBinding)need(same(existingBinding,binding),'STUDY_WORKFLOW_INPUT_CHANGED');
  else await immutableJson(inputFile,binding);
  const completed=await optionalJson(join(runDirectory,'result.json'));
  if(completed){
    need(completed.state==='COMPLETE'&&completed.schema===STUDY_WORKFLOW_SCHEMA&&same(completed.binding,binding),
      'STUDY_WORKFLOW_RESULT_CHANGED');
    for(const artifact of completed.artifacts){
      const checked=await identity(safeArtifactPath(runDirectory,artifact.file));
      need(checked.bytes===artifact.bytes&&checked.sha256===artifact.sha256,'STUDY_WORKFLOW_ARTIFACT_CHANGED');
    }
    return {...completed,recovered:true};
  }
  const browserDriver=drivers.browser??(await import('./study-extraction-browser.mjs')).runStudyExtractionBrowser;
  const merchantDriver=drivers.merchant??(await import('./study-extraction-merchant-receiving.mjs')).runStudyExtractionMerchant;
  const eligibilityDriver=drivers.eligibility??(await import('./study-extraction-eligibility.mjs')).runStudyExtractionEligibility;
  need([browserDriver,merchantDriver,eligibilityDriver].every(value=>typeof value==='function'),
    'STUDY_WORKFLOW_ORIGINAL_DRIVERS_REQUIRED');
  const storeOptions={};
  const workspaceDirectory=await privateDirectory(join(runDirectory,'workspace'));
  const original=await openDossierStore(workspaceDirectory,storeOptions);
  const originalSeed=await seed({store:original,operation,runDirectory,inputs}),id=originalSeed.dossierId;
  const sourceCase=await bindStudyExtractionCase({
    store:original,dossierId:id,questionId:originalSeed.questionId,occurrenceId:originalSeed.occurrenceId,
    revision:originalSeed.originalRevision,inputs});
  await immutableJson(join(runDirectory,'source-case.json'),sourceCase);
  need(sourceCase.dossierId===id&&sourceCase.source?.sha256===ORIGINAL_STUDY.sha256&&
    sourceCase.questionId===originalSeed.questionId&&sourceCase.occurrenceId===originalSeed.occurrenceId,
    'STUDY_WORKFLOW_SOURCE_CASE_CHANGED');
  const outputDirectory=await privateDirectory(join(runDirectory,'delivery')),artifacts=[];
  for(const [name,bytes]of [[ORIGINAL_STUDY.fileName,inputs.raw],['original-provenance.json',inputs.provenanceBytes],
    ['original-result-projection.json',inputs.projectionBytes],['original-source-bundle.json',inputs.bundle.bytes]]){
    const file=join(outputDirectory,name);await immutable(file,bytes);artifacts.push({...await identity(file),kind:'source'});
  }
  const requestDirectory=await privateDirectory(join(runDirectory,'requests','sender'));
  const step=steps({store:original,dossierId:id,operation:operation+'-sender',directory:requestDirectory});
  const senderConnection=join(runDirectory,'connection.json'),app=await openApp(workspaceDirectory,senderConnection);
  let senderBrowser,selection,formEdition,merchant,eligibility;
  try{
    senderBrowser=await checkpoint(join(runDirectory,'sender-browser.json'),async()=>{
      const result=await browserDriver({url:app.url,dossierId:id,questionId:originalSeed.questionId,
        studyId:originalSeed.studyId,studyVersion:originalSeed.studyVersion,sourceCase,
        runDirectory:await privateDirectory(join(runDirectory,'sender-browser')),playwrightModule,chromiumExecutable,mode:'author'});
      need(object(result)&&typeof result.formId==='string'&&typeof result.formEditionId==='string'&&
        typeof result.resultSetId==='string'&&Number.isSafeInteger(result.reviewedRevision)&&
        Number.isSafeInteger(result.currentRevision)&&typeof result.reviewRequestFile==='string',
        'STUDY_WORKFLOW_COMPLETE_BROWSER_SELECTION_REQUIRED');
      return result;
    });
    const accepted=await inspectResultSet(original,id,senderBrowser.resultSetId,sourceCase,senderBrowser.reviewedRevision);
    const initial={formId:senderBrowser.formId,formEditionId:senderBrowser.formEditionId,resultSetId:senderBrowser.resultSetId,
      originalRevision:senderBrowser.originalRevision,reviewedRevision:accepted.revision,currentRevision:senderBrowser.currentRevision,
      reviewRequestFile:senderBrowser.reviewRequestFile,summary:accepted.summary};
    selection=await checkpoint(join(runDirectory,'sender-publication.json'),()=>publishTable({
      store:original,id,sourceCase,selection:initial,step,edition:1}));
    formEdition=await checkpoint(join(runDirectory,'form-v2.json'),()=>reviseForm({
      store:original,id,sourceCase,selection,step}));
    await reviewPublicationImpacts({store:original,id,selection,step,label:'baseline',
      reason:'The completed baseline remains bound to its original form and original source while form v2 prepares the continued receiving review.'});
    const senderRevision=await checkpoint(join(runDirectory,'sender-revision.json'),async()=>({
      revision:(await original.getMetadata(id)).revision}));
    selection={...selection,currentRevision:senderRevision.revision};
    const replayRequests=[
      await replaySelection(original,id,initial,'reviewExtraction'),
      await replaySelection(original,id,{reviewRequestFile:selection.publicationRequestFile},'reviewExtractionPublication')
    ];
    const merchantDirectory=await privateDirectory(join(runDirectory,'sender-merchant'));
    merchant=await checkpoint(join(runDirectory,'sender-merchant.json'),()=>merchantDriver({
      connectionFile:senderConnection,workspaceDirectory,expectedWorkspaceId:app.workspaceId,
      dossierId:id,revision:selection.currentRevision,formId:selection.formId,resultSetId:selection.resultSetId,
      tableId:selection.tableId,publicationId:selection.publicationId,source:merchantSource(sourceCase),
      replayRequests,runDirectory:merchantDirectory}));
    eligibility=await checkpoint(join(runDirectory,'sender-eligibility.json'),async()=>eligibilityDriver({
      connectionFile:senderConnection,expectedWorkspaceId:app.workspaceId,dossierId:id,revision:selection.currentRevision,
      reviewId:originalSeed.reviewId,workSetId:originalSeed.workSetId,
      reviewRequestFile:join(runDirectory,'requests','seed','link-original-study.request.json'),
      runDirectory:await privateDirectory(join(runDirectory,'sender-eligibility')),python:options.python??'python3'}));
    need((await original.getMetadata(id)).revision===selection.currentRevision,'STUDY_WORKFLOW_SENDER_REPLAY_CHANGED_HEAD');
    need(same(await siblingState(original,id,originalSeed.siblingQuestionId,selection.currentRevision),originalSeed.sibling),
      'STUDY_WORKFLOW_SIBLING_CHANGED');
  }finally{await app.close();}
  artifacts.push(...await screenshots(senderBrowser,runDirectory));
  artifacts.push(...await verifiedDeliveryArtifacts(merchant,runDirectory,'merchant-sender'));
  artifacts.push(...await verifiedDeliveryArtifacts(eligibility,runDirectory,'eligibility-customer'));
  artifacts.push(...await saveDossierReports({store:original,id,revision:selection.currentRevision,directory:outputDirectory,label:'baseline'}));
  artifacts.push(...await saveExtractionReports({store:original,id,selection,revision:selection.currentRevision,directory:outputDirectory,label:'baseline'}));
  artifacts.push(...await saveTableExports({store:original,id,selection,revision:selection.currentRevision,directory:outputDirectory,label:'baseline'}));
  const jsonFile=join(outputDirectory,'baseline.research.json'),gzipFile=jsonFile+'.gz';
  artifacts.push(await savePortable({store:original,id,revision:selection.currentRevision,file:jsonFile,compression:'none'}));
  artifacts.push(await savePortable({store:original,id,revision:selection.currentRevision,file:gzipFile,compression:'gzip'}));
  need(absolute(eligibility.jsonDirectory)&&absolute(eligibility.streamDirectory)&&
    eligibility.jsonDirectory.startsWith(runDirectory+sep)&&eligibility.streamDirectory.startsWith(runDirectory+sep),
    'STUDY_WORKFLOW_CUSTOMER_RECEIVING_REQUIRED');
  const jsonStore=await openDossierStore(eligibility.jsonDirectory,storeOptions);
  const jsonReceiving=await checkpoint(join(runDirectory,'json-receiving.json'),()=>verifyReceiving({
    original,received:jsonStore,id,revision:selection.currentRevision,sourceCase,selections:[selection],sibling:originalSeed.sibling}));
  const receivingDirectory=await privateDirectory(eligibility.streamDirectory);
  const receiving=await openDossierStore(receivingDirectory,storeOptions);
  const gzipReceiving=await checkpoint(join(runDirectory,'gzip-receiving.json'),()=>verifyReceiving({
    original,received:receiving,id,revision:selection.currentRevision,sourceCase,selections:[selection],sibling:originalSeed.sibling}));
  const receivedStep=steps({store:receiving,dossierId:id,operation:operation+'-received',
    directory:await privateDirectory(join(runDirectory,'requests','received'))});
  const continued=await checkpoint(join(runDirectory,'received-review.json'),()=>continueInReceiving({
    store:receiving,id,seed:originalSeed,sourceCase,selection,formEdition,step:receivedStep}));
  let receivedSelection=await checkpoint(join(runDirectory,'received-publication.json'),()=>publishTable({
    store:receiving,id,sourceCase,selection:continued,step:receivedStep,previous:selection,edition:2}));
  await reviewPublicationImpacts({store:receiving,id,selection,step:receivedStep,label:'received-baseline',
    reason:'The complete new publication uses the received form-v2 result set; the original publication remains available as the baseline.'});
  const current=await checkpoint(join(runDirectory,'received-revision.json'),async()=>({revision:(await receiving.getMetadata(id)).revision}));
  receivedSelection={...receivedSelection,currentRevision:current.revision};
  const receivedConnection=join(runDirectory,'received-connection.json'),receivedApp=await openApp(receivingDirectory,receivedConnection);
  let receivedBrowser,receivedMerchant;
  try{
    receivedBrowser=await checkpoint(join(runDirectory,'received-browser.json'),async()=>browserDriver({
      url:receivedApp.url,dossierId:id,questionId:originalSeed.questionId,studyId:originalSeed.studyId,
      studyVersion:originalSeed.studyVersion,sourceCase,selection:receivedSelection,
      runDirectory:await privateDirectory(join(runDirectory,'received-browser')),playwrightModule,chromiumExecutable,mode:'inspect'}));
    need(receivedBrowser.resultSetId===receivedSelection.resultSetId&&receivedBrowser.formId===receivedSelection.formId,
      'STUDY_WORKFLOW_RECEIVED_BROWSER_SELECTION_CHANGED');
    const replayRequests=[
      await replaySelection(receiving,id,continued,'reviewExtraction'),
      await replaySelection(receiving,id,{reviewRequestFile:receivedSelection.publicationRequestFile},'reviewExtractionPublication')
    ];
    receivedMerchant=await checkpoint(join(runDirectory,'received-merchant.json'),async()=>merchantDriver({
      connectionFile:receivedConnection,workspaceDirectory:receivingDirectory,expectedWorkspaceId:receivedApp.workspaceId,
      dossierId:id,revision:receivedSelection.currentRevision,formId:receivedSelection.formId,
      resultSetId:receivedSelection.resultSetId,tableId:receivedSelection.tableId,publicationId:receivedSelection.publicationId,
      againstPublicationId:selection.publicationId,source:merchantSource(sourceCase),replayRequests,runDirectory:await privateDirectory(join(runDirectory,'received-merchant'))}));
    need((await receiving.getMetadata(id)).revision===receivedSelection.currentRevision,'STUDY_WORKFLOW_RECEIVED_REPLAY_CHANGED_HEAD');
    need((await original.getMetadata(id)).revision===selection.currentRevision,'STUDY_WORKFLOW_SENDER_CHANGED_AFTER_RECEIVING');
    need(same(await siblingState(receiving,id,originalSeed.siblingQuestionId,receivedSelection.currentRevision),originalSeed.sibling),
      'STUDY_WORKFLOW_RECEIVED_SIBLING_CHANGED');
  }finally{await receivedApp.close();}
  artifacts.push(...await screenshots(receivedBrowser,runDirectory));
  artifacts.push(...await verifiedDeliveryArtifacts(receivedMerchant,runDirectory,'merchant-received'));
  artifacts.push(...await saveDossierReports({store:receiving,id,revision:receivedSelection.currentRevision,directory:outputDirectory,label:'continued'}));
  artifacts.push(...await saveExtractionReports({store:receiving,id,selection:receivedSelection,revision:receivedSelection.currentRevision,directory:outputDirectory,label:'continued'}));
  artifacts.push(...await saveTableExports({store:receiving,id,selection:receivedSelection,revision:receivedSelection.currentRevision,directory:outputDirectory,label:'continued'}));
  artifacts.push(...await saveTableExports({store:receiving,id,selection:receivedSelection,revision:receivedSelection.currentRevision,
    directory:outputDirectory,label:'continued',againstPublicationId:selection.publicationId}));
  const continuedJson=join(outputDirectory,'continued.research.json'),continuedGzip=continuedJson+'.gz';
  artifacts.push(await savePortable({store:receiving,id,revision:receivedSelection.currentRevision,file:continuedJson,compression:'none'}));
  artifacts.push(await savePortable({store:receiving,id,revision:receivedSelection.currentRevision,file:continuedGzip,compression:'gzip'}));
  const finalStore=await openDossierStore(join(runDirectory,'final-received-workspace'),storeOptions);
  await reopen({store:finalStore,file:continuedJson,format:'json'});
  await reopen({store:finalStore,file:continuedGzip,format:'json.gz'});
  const continuedReceiving=await checkpoint(join(runDirectory,'continued-receiving.json'),()=>verifyReceiving({
    original:receiving,received:finalStore,id,revision:receivedSelection.currentRevision,sourceCase,
    selections:[selection,receivedSelection],sibling:originalSeed.sibling}));
  return completeResult({runDirectory,binding,seed:originalSeed,selection,receivedSelection,artifacts,
    jsonReceiving,gzipReceiving,continuedReceiving,senderBrowser,receivedBrowser,merchant,receivedMerchant,eligibility});
}
export async function runStudyExtractionWorkflow(options,drivers={}){
  need(object(options)&&typeof options.operation==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(options.operation),
    'STUDY_WORKFLOW_OPERATION_REQUIRED');
  for(const key of ['runDirectory','studyFile','provenanceFile','projectionFile','playwrightModule','chromiumExecutable'])
    need(absolute(options[key]),'STUDY_WORKFLOW_ABSOLUTE_PATH_REQUIRED');
  need(object(drivers),'STUDY_WORKFLOW_DRIVERS_INVALID');
  const runDirectory=await privateDirectory(options.runDirectory);
  return withPrivateLock(runDirectory,'study-extraction.lock',()=>runHeld({...options,runDirectory},drivers));
}
async function main(){
  const {values}=parseArgs({strict:true,options:Object.fromEntries([
    'operation','run-directory','study-file','provenance-file','projection-file','playwright-module','chromium','python'
  ].map(name=>[name,{type:'string'}]))});
  const result=await runStudyExtractionWorkflow({operation:values.operation,runDirectory:values['run-directory'],
    studyFile:values['study-file'],provenanceFile:values['provenance-file'],projectionFile:values['projection-file'],
    playwrightModule:values['playwright-module'],chromiumExecutable:values.chromium,python:values.python??'python3'});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'STUDY_EXTRACTION_WORKFLOW_FAILED',
    message:error.message})+'\n');process.exitCode=1;});
