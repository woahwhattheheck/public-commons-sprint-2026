// MIT. Commission the original NCT publications through the existing customer product.
import {join,resolve,isAbsolute} from 'node:path';
import {ResearchWorkspaceClient} from './workspace-client.mjs';
import {ORIGINAL_STUDY,STUDY_CASE_REVIEWERS,STUDY_CASE_SCHEMA} from './study-extraction-case.mjs';
import {extractionDigest} from './study-extraction.mjs';
import {customerBrief,requireCustomerUpdate as need} from './customer-updates/contracts.mjs';
import {customerUpdateSame} from './customer-updates/context.mjs';
import {customerDirectory,withCustomerOperation,retainCustomerJson,readCustomerJson,describeCustomerFile,
  inspectCustomerHandover} from './customer-updates/files.mjs';
import {runResearchCustomerDelivery} from './customer-updates/receiving.mjs';
import {exists} from '../node/store.mjs';

export const STUDY_CUSTOMER_SCHEMA='sf88-study-extraction-customer-programme/v1';
const clone=value=>structuredClone(value);
const actor=STUDY_CASE_REVIEWERS[2];
const planId='original-nct03529110-registry';
const reference='DBC61-SCF-STUDY-EXTRACTION-20261012';
const selectedKeys=['formId','formEditionId','resultSetId','tableId','tableEditionId','publicationId',
  'publicationSha256','publicationRevision','currentRevision'];
const selection=value=>Object.fromEntries(selectedKeys.map(key=>[key,value[key]]));
function checkSignal(signal){signal?.throwIfAborted();}
function connectionClient(file,signal){
  need(typeof file==='string'&&isAbsolute(file),'STUDY_CUSTOMER_CONNECTION_FILE_REQUIRED');
  return new ResearchWorkspaceClient({connectionFile:file},{
    timeoutMs:900000,
    fetch:(input,init={})=>{
      checkSignal(signal);
      return globalThis.fetch(input,{...init,...(signal?{signal:AbortSignal.any([signal,...(init.signal?[init.signal]:[])])}:{})});
    }
  });
}
async function records(client,id,revision,ids,signal){
  const wanted=new Set(ids),found=new Map();let offset=0,total;
  do{
    checkSignal(signal);
    const page=await client.customerUpdates().list(id,{revision,section:'records',offset,limit:100},{signal});
    need(page.revision===revision&&page.section==='records'&&page.offset===offset&&
      Array.isArray(page.items)&&Number.isSafeInteger(page.total)&&
      (total===undefined||total===page.total),'STUDY_CUSTOMER_RECORD_PAGE_CHANGED');
    total=page.total;
    for(const row of page.items){
      if(!wanted.has(row.id))continue;
      need(!found.has(row.id),'STUDY_CUSTOMER_RECORD_ID_AMBIGUOUS');
      const value=await client.customerUpdates().record(id,{revision,path:row.path,sha256:row.sha256,label:row.label},{signal});
      need(value.record?.id===row.id,'STUDY_CUSTOMER_NATIVE_RECORD_CHANGED');
      found.set(row.id,{selection:{path:value.path,sha256:value.sha256,label:value.label},record:value.record});
    }
    if(page.nextOffset===null)break;
    need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset,'STUDY_CUSTOMER_RECORD_CURSOR_CHANGED');
    offset=page.nextOffset;
  }while(true);
  need(found.size===wanted.size,'STUDY_CUSTOMER_COMPLETE_NATIVE_RECORDS_REQUIRED');
  return found;
}
function selectedRecordIds(seed,selected){
  return [seed.questionId,seed.studyId,selected.formEditionId,selected.resultSetId,selected.tableEditionId,selected.publicationId];
}
function verifyPublication(record,selected,sourceCase,edition){
  need(record.id===selected.publicationId&&record.sha256===selected.publicationSha256&&
    record.tableId===selected.tableId&&record.tableEditionId===selected.tableEditionId&&
    record.edition===edition&&record.rows.length===sourceCase.rows.length,
    'STUDY_CUSTOMER_FROZEN_PUBLICATION_CHANGED');
  const {sha256,...body}=record;
  need(extractionDigest(body)===sha256,'STUDY_CUSTOMER_PUBLICATION_HASH_CHANGED');
  const rowIds=new Set();
  for(const row of record.rows){
    const value=row.result,original=value.record.row.context?.source;
    need(value.status==='RESOLVED'&&value.record.resultSet.id===selected.resultSetId&&
      original?.sha256===ORIGINAL_STUDY.sha256&&original.occurrenceId===sourceCase.occurrenceId&&
      original.questionId===sourceCase.questionId&&!rowIds.has(value.record.row.id),
      'STUDY_CUSTOMER_PUBLICATION_SOURCE_CHANGED');
    rowIds.add(value.record.row.id);
  }
  need(sourceCase.rows.every(row=>rowIds.has(row.id)),'STUDY_CUSTOMER_PUBLICATION_ROWS_INCOMPLETE');
}
function commissioningBrief(seed,edition,sourceTerms,sourceHandle){
  return customerBrief({
    name:'NCT03529110 complete outcome evidence delivery',
    customer:{id:'commons-research-commissioning',name:'Commons research commissioning',reference},
    purpose:'Operate the complete original study as a reusable research delivery: independent extraction, reviewed table editions, an explicit commissioning brief and an editable received handover.',
    owner:clone(actor),questionIds:[seed.questionId],
    protocol:{title:'Original NCT03529110 outcome extraction and received review',version:'delivery-'+edition,
      source:reference,notes:'Use the original question, Eligibility Study, fourteen measurement rows and all thirteen source-bound fields per row.'},
    sourcePlans:[{id:planId,name:'Original retained NCT03529110 registry study',questionId:seed.questionId,
      provider:'ClinicalTrials.gov',query:'NCT03529110',parameters:{nctId:'NCT03529110'},
      original:clone(sourceHandle),terms:sourceTerms,
      constraints:'Keep the original posted registry bytes, original outcome populations and denominator scopes. Every later delivery points to the original occurrence and exact reviewed native publication.'}],
    outputs:[
      {id:'source',label:'Original retained study and source context',format:'JSON and Research dossier',
        acceptance:'The original 99,951-byte study and provenance remain attached to the selected occurrence.'},
      {id:'evidence-table',label:'Complete reviewed outcome evidence table',format:'JSON, CSV, Markdown and HTML',
        acceptance:'All fourteen original measurement rows preserve their full reviewed values and original source/denominator scope.'},
      {id:'editable-delivery',label:'Editable customer receiving package',format:'Research portable dossier and customer reports',
        acceptance:'The original delivery, work snapshot and requested update reopen with their exact saved identities.'},
      ...(edition===2?[{id:'denominator-context',label:'Explicit denominator review and prior-edition lineage',format:'Reviewed form and table editions',
        acceptance:'The second form/table edition retains the first publication and the complete receiving review.'}]:[])
    ],
    scope:{currency:'',amount:'',unit:'complete internal commissioning programme',note:'Original SCF Research engineering programme.',reference},
    updatePolicy:'Preserve the original source and each published edition. Record changed delivery instructions before preparing the next work snapshot; receive that complete work into the existing customer workspace.'
  });
}
function review(brief,{edition,correction=false}){
  return {
    summary:correction?
      'The receiving workspace retains both complete outcome publications and the updated commissioning brief. The final delivery makes the original source cut, denominator context and earlier review lineage explicit.':
      edition===1?'Baseline delivery selects the complete source-bound first publication and its independent extraction records.':
        'The updated delivery selects the completed receiving review and second table edition, including explicit denominator instructions and the original publication.',
    limitations:'The evidence table uses the retained registry data cut and its original analysis populations. Source fields preserve original NA strings, absent-field statuses, comments and confidence-bound wording.',
    changeDecisions:[],
    acceptance:brief.outputs.map(output=>({outputId:output.id,status:output.id==='editable-delivery'&&!correction?'not_reviewed':'met',
      note:output.id==='editable-delivery'?
        (correction?'The original updated handover has been received into this workspace; its saved delivery and reviewed work identities matched before this correction.':
          'The native handover and receiving steps follow this frozen review; their actual results are retained in the same programme.'):
        output.id==='source'?'The selected original occurrence and exact study member were read through the native source resolver.':
          output.id==='denominator-context'?'The selected second form, result set and frozen table retain the complete original publication and all fourteen reviewed rows.':
          'The original native publication contains the complete fourteen-row source population with resolved result records.'})),
    note:correction?'Apply the receiving-side clarification to the cover and delivery notes while preserving every frozen source and table record.':
      'The underlying original source comparison is retained by the native customer preview and saved work snapshot.'
  };
}
function requested(label,receivedAt,note,instructions){
  return {label,request:{by:clone(actor),receivedAt,reference,note},periods:[],instructions};
}
async function prepareCase({sender,receiver,directory,seed,sourceCase,baselineSelection,updatedSelection,signal}){
  const binding={schema:STUDY_CUSTOMER_SCHEMA,dossierId:seed.dossierId,questionId:seed.questionId,
    studyId:seed.studyId,studyVersion:seed.studyVersion,sourceCaseSha256:sourceCase.sha256,
    sourceOccurrenceId:seed.occurrenceId,sourceEditionId:sourceCase.sourceBinding.editionId,
    baseline:selection(baselineSelection),updated:selection(updatedSelection)};
  return withCustomerOperation(join(directory,'case'),async root=>{
    await retainCustomerJson(root,'selection.json',binding);
    const existing=join(root,'case.json');
    if(await exists(existing)){
      const saved=(await readCustomerJson(existing)).value;
      need(saved.dossierId===seed.dossierId,'STUDY_CUSTOMER_CASE_DOSSIER_CHANGED');return saved;
    }
    checkSignal(signal);
    const current=await sender.metadata(seed.dossierId),received=await receiver.metadata(seed.dossierId);
    need(current.revision>=updatedSelection.currentRevision&&received.revision>=updatedSelection.currentRevision,
      'STUDY_CUSTOMER_EXISTING_RECEIVERS_REQUIRED');
    const source=(await sender.metadata(seed.dossierId,{revision:updatedSelection.currentRevision})).editions
      .find(row=>row.id===sourceCase.sourceBinding.editionId);
    need(source?.questionId===seed.questionId&&source.mode==='retained','STUDY_CUSTOMER_ORIGINAL_EDITION_REQUIRED');
    const values=await sender.extractionSourceValues(seed.dossierId,{
      revision:updatedSelection.currentRevision,occurrenceId:seed.occurrenceId,fileName:ORIGINAL_STUDY.fileName,
      pointers:['/protocolSection/identificationModule/nctId']});
    need(values.occurrence?.editionId===source.id&&values.values?.length===1&&values.values[0].found&&
      values.values[0].contentSha256===ORIGINAL_STUDY.sha256&&values.values[0].contentBytes===ORIGINAL_STUDY.bytes&&
      customerUpdateSame(values.values[0].typedValue,['str','NCT03529110']),'STUDY_CUSTOMER_ORIGINAL_SOURCE_CHANGED');
    const baselineIds=selectedRecordIds(seed,baselineSelection),updatedIds=[...new Set([
      ...selectedRecordIds(seed,updatedSelection),baselineSelection.publicationId,baselineSelection.formEditionId])];
    const native=await records(sender,seed.dossierId,updatedSelection.currentRevision,[...baselineIds,...updatedIds],signal);
    verifyPublication(native.get(baselineSelection.publicationId).record,baselineSelection,sourceCase,1);
    verifyPublication(native.get(updatedSelection.publicationId).record,updatedSelection,sourceCase,2);
    need(native.get(updatedSelection.publicationId).record.previousPublicationId===baselineSelection.publicationId,
      'STUDY_CUSTOMER_PUBLICATION_LINEAGE_CHANGED');
    const sourceHandle={kind:'ORIGINAL_RETAINED_STUDY',dossierId:seed.dossierId,editionId:source.id,
      occurrenceId:seed.occurrenceId,questionId:seed.questionId,studyId:seed.studyId,studyVersion:seed.studyVersion,
      fileName:ORIGINAL_STUDY.fileName,sha256:ORIGINAL_STUDY.sha256,bytes:ORIGINAL_STUDY.bytes,
      originalEdition:clone(source),sourceBinding:clone(values.occurrence)};
    const terms=typeof source.sourceTerms==='string'&&source.sourceTerms.trim()?source.sourceTerms:
      'Original ClinicalTrials.gov registry response retained with its original source metadata in this dossier.';
    const baselineBrief=commissioningBrief(seed,1,terms,sourceHandle),updatedBrief=commissioningBrief(seed,2,terms,sourceHandle);
    const intake={planId,editionIds:[source.id],original:sourceHandle,
      note:'The original retained source edition supplies this delivery; reviewed table changes remain separate native records.'};
    const createdAt=new Date().toISOString();
    const baselineRequest=requested('Complete first outcome evidence publication',createdAt,
      'Commission the original complete reviewed first table as the baseline delivery.',
      'Include all original measurement rows and retained independent reviewer records.');
    const updateRequest=requested('Deliver the completed receiving review',createdAt,
      'Continue the original commissioning with the completed second form and table edition.',
      'Include the completed receiving review and retain the original baseline publication.');
    const revisedRequest=requested('Deliver the receiving review with explicit denominator context',createdAt,
      'Clarify the delivery requirements to carry denominator scope, original data cut and prior-edition lineage into the receiving package.',
      'Preserve baseline and updated publications, the current complete review and explicit denominator guidance in the same editable dossier.');
    const caseDefinition={schema:'sf88-research-customer-delivery-case/v1',name:'Original NCT03529110 study delivery and receiving',
      dossierId:seed.dossierId,actor:clone(actor),
      baseline:{brief:baselineBrief,request:baselineRequest,intakes:[clone(intake)],
        records:baselineIds.map(id=>native.get(id).selection),review:review(baselineBrief,{edition:1}),
        delivery:{title:'NCT03529110 complete outcome evidence — baseline',
          coverNote:'Complete reviewed first publication, original registry source and independent review history.',
          deliveryNote:'The source-bound baseline preserves every original row, population and denominator scope.'}},
      update:{brief:updatedBrief,briefReason:'Add the explicit denominator-context deliverable and original-to-received publication lineage.',
        request:updateRequest,requestRevision:revisedRequest,
        requestRevisionReason:'The full received delivery includes the original data cut and denominator guidance alongside both table editions.',
        intakes:[clone(intake)],records:updatedIds.map(id=>native.get(id).selection),review:review(updatedBrief,{edition:2}),
        delivery:{title:'NCT03529110 complete outcome evidence — received review',
          coverNote:'The completed second review is delivered with the frozen first publication and original source.',
          deliveryNote:'Reopen this complete customer handover to continue reviewing the same study and its publication history.'}},
      correction:{request:requested('Receiving clarification of source scope and review lineage',createdAt,
          'Complete the receiving-side delivery by clarifying source scope and the relationship between its reviewed table editions.',
          'Carry the same source and complete reviewed table records into the final cover and delivery notes.'),
        intakes:[clone(intake)],records:updatedIds.map(id=>native.get(id).selection),
        review:review(updatedBrief,{edition:2,correction:true}),
        delivery:{title:'NCT03529110 complete outcome evidence — final received delivery',
          coverNote:'This received delivery preserves the original registry data cut, all fourteen measurement rows and each original denominator container. Both reviewed table editions remain available.',
          deliveryNote:'The baseline retains the independent 79.0 entry and source-based resolution to 79.7. The continued review preserves its own two complete submissions, consensus results and explicit denominator guidance.'}}
    };
    await retainCustomerJson(root,'source-selection.json',{source:sourceHandle,originalSource:values,
      records:[...native.entries()].map(([id,value])=>({id,...value.selection}))});
    await retainCustomerJson(root,'case.json',caseDefinition);return caseDefinition;
  });
}
async function handoverArtifacts(directory){
  const value=await inspectCustomerHandover(directory),result=[];
  for(const file of value.files){
    const checked=await describeCustomerFile(file.path,{sha256:file.sha256,bytes:file.bytes});
    result.push({file:checked.path,bytes:checked.bytes,sha256:checked.sha256,
      ...(file.contentType?{contentType:file.contentType}:{})});
  }
  const manifest=await describeCustomerFile(join(directory,'handover.json'),{sha256:value.manifestSha256,bytes:value.manifestBytes});
  result.push({file:manifest.path,bytes:manifest.bytes,sha256:manifest.sha256,contentType:'application/json'});
  return result;
}
export async function runStudyExtractionCustomer({senderConnectionFile,receiverConnectionFile,runDirectory,
  seed,sourceCase,baselineSelection,updatedSelection,signal}={}){
  need(typeof runDirectory==='string'&&isAbsolute(runDirectory)&&resolve(runDirectory)===runDirectory,
    'STUDY_CUSTOMER_ABSOLUTE_DIRECTORY_REQUIRED');
  need(sourceCase?.schema===STUDY_CASE_SCHEMA&&sourceCase.dossierId===seed?.dossierId&&
    sourceCase.questionId===seed.questionId&&sourceCase.occurrenceId===seed.occurrenceId&&
    sourceCase.source?.sha256===ORIGINAL_STUDY.sha256&&sourceCase.sourceBinding?.editionId&&
    baselineSelection?.publicationId&&updatedSelection?.publicationId,
    'STUDY_CUSTOMER_ORIGINAL_STUDY_SELECTION_REQUIRED');
  const {sha256,...caseBody}=sourceCase;
  need(sha256===extractionDigest(caseBody),'STUDY_CUSTOMER_SOURCE_CASE_CHANGED');
  checkSignal(signal);
  const directory=await customerDirectory(runDirectory),sender=connectionClient(senderConnectionFile,signal),
    receiver=connectionClient(receiverConnectionFile,signal);
  try{
    const caseDefinition=await prepareCase({sender,receiver,directory,seed,sourceCase,baselineSelection,updatedSelection,signal});
    checkSignal(signal);
    const result=await runResearchCustomerDelivery({sender,receiver,directory:join(directory,'programme'),caseDefinition});
    checkSignal(signal);
    const count=result.baseline.work.counts.sources;
    need(count>0&&result.baseline.work.changeCounts.ADDED===count&&
      result.update.work.counts.sources===count&&result.correction.work.counts.sources===count&&
      ['ADDED','CHANGED','REMOVED'].every(key=>result.update.work.changeCounts[key]===0&&result.correction.work.changeCounts[key]===0)&&
      result.update.work.changeCounts.UNCHANGED===count&&result.correction.work.changeCounts.UNCHANGED===count,
      'STUDY_CUSTOMER_RETAINED_SOURCE_POPULATION_CHANGED');
    const files=[...await handoverArtifacts(result.delivery.directory),...await handoverArtifacts(result.correctionDelivery.directory)];
    for(const file of [join(directory,'case','selection.json'),join(directory,'case','source-selection.json'),
      join(directory,'case','case.json'),join(directory,'programme','original-request-replays.json'),join(directory,'programme','result.json')]){
      const checked=await describeCustomerFile(file);files.push({file:checked.path,bytes:checked.bytes,sha256:checked.sha256,contentType:'application/json'});
    }
    const value={schema:STUDY_CUSTOMER_SCHEMA,state:'COMPLETE',dossierId:seed.dossierId,
      projectId:result.projectId,source:clone(result.source),receiver:clone(result.receiver),
      baseline:{requestId:result.baseline.request.id,workId:result.baseline.work.id,deliveryId:result.baseline.delivery.id,
        publicationId:baselineSelection.publicationId,revision:result.baseline.delivery.revision},
      updated:{requestId:result.update.request.id,workId:result.update.work.id,deliveryId:result.update.delivery.id,
        publicationId:updatedSelection.publicationId,revision:result.update.delivery.revision},
      correction:{requestId:result.correction.request.id,workId:result.correction.work.id,deliveryId:result.correction.delivery.id,
        revision:result.correction.delivery.revision},sourceCounts:{baseline:result.baseline.work.changeCounts,
        updated:result.update.work.changeCounts,correction:result.correction.work.changeCounts},
      handovers:{updated:result.delivery.manifestSha256,correction:result.correctionDelivery.manifestSha256},
      files,completedAt:result.completedAt};
    await retainCustomerJson(directory,'result.json',value);return value;
  }finally{
    const closed=await Promise.allSettled([sender.close(),receiver.close()]);
    const failed=closed.find(value=>value.status==='rejected');
    if(failed&&!signal?.aborted)throw failed.reason;
  }
}
