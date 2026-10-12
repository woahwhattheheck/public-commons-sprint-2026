// MIT. Same-store commissioning continuation; the original study creator runs first.
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';
import {openDossierStore} from '../../dossier.mjs';
import {extractionDigest} from '../../study-extraction.mjs';
import {createArtifactAuthoring} from './authoring.mjs';
import {cellAt,cellColumn,locateReturnedCell,hashBytes} from '../workbook.mjs';
const clone=x=>structuredClone(x),same=(a,b)=>extractionDigest(a)===extractionDigest(b);
const bytes=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
async function read(path){try{return await fs.readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function immutable(path,body){
 const prior=await read(path);if(prior){need(prior.equals(body),'TEMPLATE_NATIVE_FILE_CONFLICT');return;}
 await fs.mkdir(resolve(path,'..'),{recursive:true});const temporary=path+'.'+randomUUID()+'.tmp';
 await fs.writeFile(temporary,body,{flag:'wx'});try{await fs.link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;need((await fs.readFile(path)).equals(body),'TEMPLATE_NATIVE_FILE_CONFLICT');}finally{await fs.rm(temporary,{force:true});}
}
async function file(path){const body=await fs.readFile(path);return {path,bytes:body.length,sha256:hashBytes(body)};}
function checkSignal(signal){need(!signal?.aborted,'TEMPLATE_OPERATION_CANCELLED');}
function exchange(store){need(store?.templateExchange&&typeof store.templateExchange.page==='function','TEMPLATE_ORIGINAL_STORE_JOIN_REQUIRED');return store.templateExchange;}
export async function runTemplateExchangeContinuation({
 store,dossierId,revision,tableId,publicationId,sourceCase,runDirectory,signal,
 authoring,openReceivingStore=openDossierStore,emit=()=>{}
}){
 checkSignal(signal);const api=exchange(store);
 need(sourceCase?.schema==='sf88-study-extraction-commissioning-case/v1'&&sourceCase.dossierId===dossierId,'TEMPLATE_ORIGINAL_SOURCE_CASE_REQUIRED');
 need(sourceCase.source?.nctId==='NCT03529110'&&sourceCase.source.sha256==='1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1','TEMPLATE_ORIGINAL_STUDY_CHANGED');
 need(Number.isSafeInteger(revision)&&revision>=1&&publicationId&&tableId,'TEMPLATE_ORIGINAL_SELECTION_REQUIRED');
 const root=resolve(runDirectory,'template-exchange'),requests=join(root,'requests');await fs.mkdir(requests,{recursive:true});
 const selected={schema:'sf88-template-native-selection/v1',dossierId,revision,tableId,publicationId,sourceCaseSha256:sourceCase.sha256,source:sourceCase.source};
 await immutable(join(root,'original-selection.json'),bytes(selected));await immutable(join(root,'original-source-case.json'),bytes(sourceCase));
 const operation='template-'+extractionDigest(selected).slice(0,20);
 const completed=await read(join(root,'result.json'));if(completed){const result=JSON.parse(completed);need(result.operation===operation&&result.stage==='complete','TEMPLATE_NATIVE_RESULT_CONFLICT');await api.page(dossierId,{revision:result.revision});for(const item of result.files){const retained=await file(item.path);need(retained.sha256===item.sha256&&retained.bytes===item.bytes,'TEMPLATE_COMPLETED_FILE_CHANGED');}return result;}
 const actor=sourceCase.reviewers[0];need(actor?.id&&actor?.name,'TEMPLATE_ASSIGNED_NATIVE_ACTOR_REQUIRED');
 const original=await api.publication(dossierId,{revision,publicationId,limit:200});let rows=[...original.items],next=original.nextOffset;
 while(next!==null){checkSignal(signal);const page=await api.publication(dossierId,{revision,publicationId,offset:next,limit:200});rows.push(...page.items);next=page.nextOffset;}
 need(original.publication.tableId===tableId&&rows.length===14&&rows.length===original.total,'TEMPLATE_ORIGINAL_PUBLICATION_POPULATION_CHANGED');
 const originalPublication={...original.publication,rows};await immutable(join(root,'original-publication.json'),bytes(originalPublication));
 const selection={dossierId,revision,publication:original.publication,rows,sourceCase};
 let ownedAuthoring=null;
 if(!authoring){ownedAuthoring=await createArtifactAuthoring({runDirectory:root,signal});authoring=ownedAuthoring;}
 async function phase(name){checkSignal(signal);await emit({operation,phase:name,dossierId,runDirectory:root});}
 async function current(){checkSignal(signal);return (await api.page(dossierId)).revision;}
 async function savedRequest(name,make){
  const path=join(requests,name+'.json'),prior=await read(path);if(prior)return JSON.parse(prior);
  const input=await make();await immutable(path,bytes(input));return input;
 }
 async function commit(name,build){
  const request=await savedRequest(name,async()=>{
   const staged=await build();return {requestId:operation+'-'+name,expectedRevision:staged.expectedRevision,actor,
    action:staged.action,data:staged.data};
  });
  const result=await api.review(dossierId,request);
  await immutable(join(root,name+'-operation.json'),bytes(result.operation));return result.operation;
 }
 async function rejectWithoutMutation(name,run,codes){
  const evidencePath=join(root,name+'.json'),existing=await read(evidencePath);if(existing){const evidence=JSON.parse(existing);need(evidence.rejected===true&&codes.includes(evidence.code),'TEMPLATE_NATIVE_REJECTION_RECORD_CHANGED');await api.page(dossierId,{revision:evidence.revision});return evidence.code;}
  const before=await current();let caught=null;
  try{await run();}catch(e){caught=e;}
  need(caught&&codes.includes(caught.code),name+': expected '+codes.join('|')+', observed '+(caught?.code??'success'));
  need(await current()===before,name+': rejected request changed the original dossier');
  await immutable(join(root,name+'.json'),bytes({rejected:true,code:caught.code,revision:before}));return caught.code;
 }
 async function retainOutput(name,reference){const r=await api.readBlob(dossierId,{sha256:reference.sha256});need(r.bytes===reference.bytes,'TEMPLATE_RECEIVING_BLOB_SIZE_CHANGED');
  const path=join(root,name);await immutable(path,r.body);return file(path);}
 const files=[];
 try{
  await phase('author-original-study-template');
  const layout=await authoring.create({selection,directory:join(root,'template-authoring')});
  files.push(await file(layout.path));for(const preview of layout.previews)files.push(await file(preview.path));
  const template=await commit('retain-template',async()=>{
   const specification=await api.stageWorkbook({filename:'Research_Extraction_Template.xlsx',body:await fs.readFile(layout.path)});
   return {expectedRevision:await current(),action:'retain-template',data:{name:'Original research client template',edition:specification,reason:'Retain the complete skill-authored commissioning template for this original publication.'}};
  });
  const edition=template.result.edition,templateId=template.result.template.id;
  await phase('map-all-original-fields');
  const mapping=await commit('save-mapping',async()=>{const stage=await api.stageMapping(dossierId,{revision:await current(),templateEditionId:edition.id,publicationId,bindings:layout.bindings});
   stage.data.reason='Map all original field values to the reviewed client cells, with one exact result ID per data row.';return stage;});
  const duplicate=clone(layout.bindings[0]);duplicate.id='duplicate-row';duplicate.cell=cellColumn(duplicate.cell)+(layout.lastRow+1);
  // This is a read-only stage rejection on the actual original workbook.
  await rejectWithoutMutation('ambiguous-identity-rejected',()=>api.stageMapping(dossierId,{revision:undefined,templateEditionId:edition.id,publicationId,bindings:[...layout.bindings,duplicate]}),['TEMPLATE_RESULT_IDENTITY_MULTIPLE_ROWS','TEMPLATE_RESULT_IDENTITY_ALREADY_ON_ANOTHER_ROW']);
  await phase('release-original-publication');
  const release=await commit('release-workbook',async()=>{const stage=await api.stageRelease(dossierId,{revision:await current(),mappingId:mapping.result.mapping.id,filename:'Research_Approved_Release.xlsx',
   review:{note:'Commissioning selection: preserve the exact frozen publication, original source strings and separate denominator scopes.',allowHistorical:true,acknowledgeNewerSource:true}});stage.data.reason='Publish the reviewed mapped workbook through the existing dossier.';return stage;});
  const released=release.result.release;files.push(await retainOutput(released.filename,released.workbook));
  const releaseRecord=await api.inspectRecord(dossierId,{revision:release.revision,kind:'release',recordId:released.id});
  need(releaseRecord.details.report.native.sourceSha256===edition.workbook.sha256&&releaseRecord.details.report.outputSha256===released.workbook.sha256,'TEMPLATE_RELEASE_SOURCE_BINDING_FAILED');
  await immutable(join(root,'release-inspection.json'),bytes(releaseRecord));files.push(await file(join(root,'release-inspection.json')));
  const changedRow=rows.find(r=>r.result.record.row.id===sourceCase.disagreement.rowId);
  need(changedRow,'TEMPLATE_ORIGINAL_DISAGREEMENT_ROW_NOT_SELECTED');
  const answer=changedRow.result.record.values[sourceCase.disagreement.fieldId];
  need(same(answer.value,sourceCase.disagreement.originalValue),'TEMPLATE_SELECTED_PUBLICATION_VALUE_CHANGED_REVIEW_REQUIRED');
  const proposal={resultId:changedRow.result.resultId,fieldId:sourceCase.disagreement.fieldId,value:sourceCase.disagreement.enteredValue[1],
   reason:'Commissioning-only client proposal: '+sourceCase.disagreement.reason+' Original registry bytes and the frozen publication remain unchanged.'};
  await phase('author-client-return');
  const returnedFile=await authoring.clientReturn({sourcePath:join(root,released.filename),directory:join(root,'client-authoring'),layout,change:proposal});
  files.push(await file(returnedFile.path));for(const preview of returnedFile.previews)files.push(await file(preview.path));
  const returnedOp=await commit('receive-return',async()=>{const stage=await api.stageReturn(dossierId,{revision:await current(),releaseId:released.id,filename:'Research_Client_Return.xlsx',body:await fs.readFile(returnedFile.path)});
   stage.data.reason='Retain the complete client-edited workbook, including reordered rows and unmapped notes.';return stage;});
  const returned=returnedOp.result.return,comparison=(await api.inspectRecord(dossierId,{kind:'return',recordId:returned.id})).details.comparison;
  need(comparison.counts.unavailableMapped===0&&comparison.counts.movedMapped>0,'TEMPLATE_NATIVE_MOVED_ROW_JOIN_FAILED');
  const actualChanges=comparison.mapped.filter(m=>m.changed);
  need(actualChanges.length===1&&actualChanges[0].resultId===proposal.resultId&&actualChanges[0].fieldId===proposal.fieldId,'TEMPLATE_CLIENT_VALUE_CHANGE_SCOPE_FAILED');
  need(comparison.unmappedCells.some(c=>c.after?.value?.value===proposal.reason),'TEMPLATE_CLIENT_NOTE_WAS_LOST');
  await immutable(join(root,'complete-client-comparison.json'),bytes(comparison));files.push(await file(join(root,'complete-client-comparison.json')));
  const decisions=actualChanges.map(m=>({bindingId:m.bindingId,disposition:'propose-correction',note:proposal.reason}));
  async function reviewReturn(name,note){return commit(name,async()=>{const stage=await api.stageReturnReview(dossierId,{revision:await current(),returnId:returned.id,decisions:decisions.map(d=>({...d,note}))});
   stage.data.reason=note;return stage;});}
  await phase('review-client-return-in-original-workflow');
  const reviewA=await reviewReturn('review-return-a','First complete review of the retained commissioning client return. '+proposal.reason);
  const reviewB=await reviewReturn('review-return-b','Final reviewed client-return proposal. '+proposal.reason);
  const resultSetId=changedRow.result.record.resultSet.id;
  const prepared=await savedRequest('original-native-draft',()=>api.prepareExtractionDraft(dossierId,{revision:undefined,reviewId:reviewB.result.review.id,actor,
   requestId:operation+'-original-draft',resultSetId,reason:'Create a complete uncertain client-return draft for the existing assigned reviewer; original submission and resolution remain separate actions.'}));
  await rejectWithoutMutation('wrong-review-rejected',()=>api.acceptExtractionDraft(dossierId,{reviewId:reviewA.result.review.id,request:prepared.request,requestBlob:prepared.blob,
   receiptRequestId:operation+'-wrong-review-receipt',reason:'This mismatched selection must not mutate the original dossier.'}),
   ['TEMPLATE_NEWER_RETURN_REVIEW_EXISTS','TEMPLATE_SELECTED_REVIEW_REQUEST_MISMATCH']);
  // Commit through the actual original engine, then recover its wrapper receipt.
  // This exercises accepted-operation recovery without manufacturing an event.
  const native=await store.reviewExtraction(dossierId,{...prepared.request,projection:'metadata'});
  await immutable(join(root,'original-native-extraction-operation.json'),bytes(native.operation));
  const accept={reviewId:reviewB.result.review.id,request:prepared.request,requestBlob:prepared.blob,
   receiptRequestId:operation+'-draft-receipt',reason:'Record the accepted original native draft and exact client-return review.'};
  const accepted=await api.acceptExtractionDraft(dossierId,accept),replayed=await api.acceptExtractionDraft(dossierId,accept);
  need(accepted.native.operation.id===native.operation.id&&accepted.native.duplicate===true&&replayed.receipt.duplicate===true,'TEMPLATE_ORIGINAL_REQUEST_RECOVERY_FAILED');
  need(same(replayed.receipt.operation,accepted.receipt.operation),'TEMPLATE_REPLAY_RECEIPT_CHANGED');
  await rejectWithoutMutation('changed-receipt-reason-rejected',()=>api.acceptExtractionDraft(dossierId,{...accept,reason:accept.reason+' changed'}),['TEMPLATE_RECEIPT_REQUEST_CONFLICT']);
  const draft=accepted.receipt.operation.result.draft;
  const nativeAnswer=native.operation.result.extraction.answers.find(a=>a.rowId===changedRow.result.record.row.id&&a.fieldId===proposal.fieldId);
  need(nativeAnswer?.status==='uncertain'&&nativeAnswer.context.templateReturn.workbookSha256===returned.workbook.sha256,'TEMPLATE_DRAFT_SOURCE_BINDING_FAILED');
  const acceptedPath=join(root,'accepted-original-draft.json'),priorAccepted=await read(acceptedPath);
  if(priorAccepted){
   const observed=JSON.parse(priorAccepted);
   need(same(observed.native?.operation,accepted.native.operation)&&same(observed.receipt?.operation,accepted.receipt.operation),'TEMPLATE_ACCEPTED_DRAFT_OPERATION_CHANGED');
  }else await immutable(acceptedPath,bytes(accepted));
  // Preserve the actual first acknowledgement; duplicate/current-head wrappers
  // may legitimately differ when these same immutable operations are replayed.
  files.push(await file(acceptedPath));
  await phase('retain-later-client-edition');
  const nextEdition=await commit('retain-client-edition',async()=>{const specification=await api.stageWorkbook({filename:'Research_Client_Return.xlsx',body:await fs.readFile(returnedFile.path)});
   return {expectedRevision:await current(),action:'revise-template',data:{templateId,expectedEditionId:edition.id,edition:specification,sourceReturnId:returned.id,
    reason:'Adopt the entire reviewed client-return file as the next template edition, retaining client notes and native row order.'}};});
  await rejectWithoutMutation('old-mapping-rejected',async()=>{
   const stage=await api.stageRelease(dossierId,{revision:await current(),mappingId:mapping.result.mapping.id,filename:'Obsolete_Mapping.xlsx',review:{note:'Obsolete mapping must be rejected.',allowHistorical:true,acknowledgeNewerSource:true}});
   await api.review(dossierId,{requestId:operation+'-old-mapping',expectedRevision:stage.expectedRevision,actor,action:stage.action,data:{...stage.data,reason:'Reject a mapping against an earlier client template.'}});
  },['TEMPLATE_LATER_CLIENT_EDITION_REQUIRES_MAPPING']);
  const nextInspection=(await api.inspectRecord(dossierId,{kind:'edition',recordId:nextEdition.result.edition.id})).details.inspection;
  const rebound=layout.bindings.map(binding=>{const location=locateReturnedCell(nextInspection,binding);return {...binding,cell:location.cell};});
  const nextMapping=await commit('map-client-edition',async()=>{const stage=await api.stageMapping(dossierId,{revision:await current(),templateEditionId:nextEdition.result.edition.id,publicationId,bindings:rebound,previousMappingId:mapping.result.mapping.id});
   stage.data.reason='Review a new explicit mapping at the actual current client row identities.';return stage;});
  const nextRelease=await commit('release-client-edition',async()=>{const stage=await api.stageRelease(dossierId,{revision:await current(),mappingId:nextMapping.result.mapping.id,filename:'Research_Reviewed_Client_Layout.xlsx',
   review:{note:'Release the original approved publication into the later client layout. The client proposal remains an uncertain original draft; this is not a new scientific adjudication.',allowHistorical:true,acknowledgeNewerSource:true}});
   stage.data.reason='Preserve later client notes and row order while filling the explicitly selected original frozen publication.';return stage;});
  const finalRelease=nextRelease.result.release;files.push(await retainOutput(finalRelease.filename,finalRelease.workbook));
  const finalInspection=(await api.inspectRecord(dossierId,{kind:'release',recordId:finalRelease.id})).details.inspection;
  const noteRow=returnedFile.change.row;
  need(cellAt(finalInspection,'Extraction',layout.notesColumn+noteRow).value.value===proposal.reason,'TEMPLATE_LATER_CLIENT_NOTE_LOST');
  const frozenAgain=await api.publication(dossierId,{publicationId,limit:200});
  need(frozenAgain.publication.sha256===original.publication.sha256,'TEMPLATE_FROZEN_PUBLICATION_MUTATED');
  await phase('export-and-reopen-original-workspace');
  const outputSelection={templateId,initialEditionId:edition.id,currentEditionId:nextEdition.result.edition.id,mappingId:nextMapping.result.mapping.id,
   initialReleaseId:released.id,releaseId:finalRelease.id,returnId:returned.id,returnReviewId:reviewB.result.review.id,draftId:draft.id,
   nativeExtractionId:draft.extractionId,nativeOperationId:native.operation.id};
  const exportBinding={schema:'sf88-template-native-export-selection/v1',operation,dossierId,tableId,publicationId,
   publicationSha256:original.publication.sha256,sourceCaseSha256:sourceCase.sha256,selection:outputSelection};
  const archivePath=join(root,'original-dossier-with-template.research.json.gz'),exportSelectionPath=join(root,'export-selection.json');
  const existingArchive=await read(archivePath),retainedSelection=await read(exportSelectionPath);
  // Freeze the source revision before streaming. A later unrelated dossier edit
  // cannot change which historical edition an interrupted export must reopen.
  need(retainedSelection||!existingArchive,'TEMPLATE_EXPORT_SELECTION_MISSING_RECONCILE_EXISTING_ARCHIVE');
  let exportSelection;
  if(retainedSelection){
   exportSelection=JSON.parse(retainedSelection);const {revision:exportRevision,...binding}=exportSelection;
   need(Number.isSafeInteger(exportRevision)&&exportRevision>=revision&&same(binding,exportBinding),'TEMPLATE_EXPORT_SELECTION_CHANGED');
  }else{
   exportSelection={...exportBinding,revision:await current()};
   await immutable(exportSelectionPath,bytes(exportSelection));
  }
  const finalRevision=exportSelection.revision;await api.page(dossierId,{revision:finalRevision});
  files.push(await file(exportSelectionPath));
  if(!existingArchive){
   const exported=await store.exportStream(dossierId,{revision:finalRevision,compression:'gzip'});
   const temporary=archivePath+'.'+randomUUID()+'.tmp';try{await pipeline(exported.body,createWriteStream(temporary,{flags:'wx'}),{signal});await immutable(archivePath,await fs.readFile(temporary));}finally{await fs.rm(temporary,{force:true});}
  }
  files.push(await file(archivePath));
  const receivingDirectory=join(root,'fresh-receiving-workspace'),receiver=await openReceivingStore(receivingDirectory);
  await receiver.reopenStream(createReadStream(archivePath),{projection:'metadata'});
  const receiving=exchange(receiver),sourcePage=await api.page(dossierId,{revision:finalRevision}),receivedPage=await receiving.page(dossierId,{revision:finalRevision});
  need(same(sourcePage,receivedPage),'TEMPLATE_RECEIVING_MODEL_CHANGED');
  let offset=0,total=0,blobs=new Map();
  for(;;){const a=await api.page(dossierId,{revision:finalRevision,section:'operations',offset,limit:25}),b=await receiving.page(dossierId,{revision:finalRevision,section:'operations',offset,limit:25});
   need(same(a,b),'TEMPLATE_RECEIVING_HISTORY_CHANGED');for(const op of a.items)for(const item of op.blobs)blobs.set(item.sha256,item);total+=a.items.length;
   if(a.nextOffset===null)break;offset=a.nextOffset;}
  for(const ref of blobs.values()){checkSignal(signal);const a=await api.readBlob(dossierId,{revision:finalRevision,sha256:ref.sha256}),b=await receiving.readBlob(dossierId,{revision:finalRevision,sha256:ref.sha256});
   need(a.body.equals(b.body),'TEMPLATE_RECEIVING_ORIGINAL_FILE_CHANGED');}
  const receiverReplay=await receiving.acceptExtractionDraft(dossierId,accept);
  need(receiverReplay.receipt.duplicate===true&&same(receiverReplay.receipt.operation,accepted.receipt.operation),'TEMPLATE_RECEIVING_REQUEST_RECOVERY_FAILED');
  const result={schema:'sf88-template-native-result/v1',operation,stage:'complete',dossierId,originalRevision:revision,revision:finalRevision,tableId,publicationId,
   publicationSha256:original.publication.sha256,sourceCaseSha256:sourceCase.sha256,
   selection:outputSelection,
   sourceRows:rows.length,mappedFields:layout.bindings.length,clientComparison:comparison.counts,retainedOperations:total,retainedBlobs:blobs.size,
   receivingDirectory,archive:await file(archivePath),files,
   nativeOutcome:'Complete original assigned-reviewer draft retained as uncertain; original source bytes, frozen publication and existing submission/adjudication history preserved.',
   checks:{exactRowIdentity:true,clientNotePreserved:true,wrongReviewNoMutation:true,originalAcceptedRequestRecovery:true,changedReceiptConflict:true,
    laterClientEditionMapping:true,completePortableReplay:true},completedAt:new Date().toISOString()};
  const resultPath=join(root,'result.json');const prior=await read(resultPath);
  if(prior){const old=JSON.parse(prior);need(old.revision===result.revision&&same(old.selection,result.selection),'TEMPLATE_NATIVE_RESULT_CONFLICT');return old;}
  await immutable(resultPath,bytes(result));await phase('complete');return result;
 }finally{await ownedAuthoring?.close();}
}
