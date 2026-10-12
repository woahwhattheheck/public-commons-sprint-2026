// MIT. Bind the authored appraisal to the original NCT dossier and immutable result.
import {fileURLToPath} from 'node:url';
import {readResearchHostFile} from '../workspace-files.mjs';
import {ORIGINAL_STUDY} from '../study-extraction-case.mjs';
import {digest,need,object,parseJson} from '../../node/store.mjs';
import {riskOfBiasDigest,riskOfBiasProtocol,riskOfBiasContent} from './contracts.mjs';

export const RISK_STUDY_CASE_SCHEMA='sf88-risk-of-bias-bound-study-case/v1';
export const RISK_STUDY_CASE_PACKET_SHA256='37bba53e865687720cb713fcefc6fbd0a6c70b72b473f46cd7352157bb9f6dd2';
export const RISK_STUDY_CASE_ROW='outcome-0-class-0-category-0-measurement-0';
const clone=value=>structuredClone(value);
const same=(left,right)=>riskOfBiasDigest(left)===riskOfBiasDigest(right);
const passageList=content=>[...content.answers.flatMap(value=>value.basis),
  ...content.judgments.flatMap(value=>value.basis),...(content.overall?.basis??[])];
const allPassages=packet=>[...packet.assessment.designBasis,
  ...packet.reviewers.flatMap(passageList),...passageList(packet.adjudication)];
const rawContent=value=>({answers:value.answers,judgments:value.judgments,overall:value.overall});
function boundContent(value,occurrenceId){
  const bind=passage=>({...clone(passage),occurrenceId});
  return {...clone(value),answers:value.answers.map(row=>({...clone(row),basis:row.basis.map(bind)})),
    judgments:value.judgments.map(row=>({...clone(row),basis:row.basis.map(bind)})),
    overall:{...clone(value.overall),basis:value.overall.basis.map(bind)}};
}
export async function loadRiskOfBiasStudyPacket({
  file=fileURLToPath(new URL('./study-case.json',import.meta.url)),
}={}){
  const bytes=await readResearchHostFile(file,1024*1024,{sha256:RISK_STUDY_CASE_PACKET_SHA256});
  const packet=parseJson(bytes);
  need(packet.schema==='sf88-risk-of-bias-original-study-case/v1'&&
    packet.operationId==='RESEARCH-STUDY-OUTCOME-REVIEW-20261012'&&
    packet.source.fileName===ORIGINAL_STUDY.fileName&&packet.source.sha256===ORIGINAL_STUDY.sha256&&
    packet.source.bytes===ORIGINAL_STUDY.bytes&&packet.selectedRowId===RISK_STUDY_CASE_ROW&&
    packet.reviewers.length===2&&packet.reviewers[0].actor.id!==packet.reviewers[1].actor.id,
    'RISK_STUDY_CASE_PACKET_CHANGED');
  riskOfBiasProtocol(packet.protocol);
  need(packet.protocol.resolverIds.includes(packet.adjudication.actor.id)&&
    packet.protocol.reviewers.some(value=>same(value,packet.operator)),'RISK_STUDY_CASE_PROCESS_CHANGED');
  return packet;
}
async function wholeSection(reader,dossierId,revision,section,{signal}={}){
  const result=[];let offset=0,total=null;
  do{
    signal?.throwIfAborted();
    const page=await reader.riskOfBias(dossierId,{revision,section,offset,limit:100});
    need(page.schema==='sf88-research-risk-of-bias-view/v1'&&page.dossierId===dossierId&&
      page.revision===revision&&page.section===section&&page.offset===offset&&Array.isArray(page.items)&&
      Number.isSafeInteger(page.total)&&page.total>=0&&(total===null||page.total===total),
      'RISK_STUDY_CASE_PAGE_CHANGED');
    total=page.total;result.push(...page.items);
    need(result.length<=total,'RISK_STUDY_CASE_PAGE_OVERLAP');
    if(page.nextOffset===null){need(result.length===total,'RISK_STUDY_CASE_PAGE_INCOMPLETE');break;}
    need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset&&page.nextOffset<total,
      'RISK_STUDY_CASE_PAGE_CURSOR_CHANGED');
    offset=page.nextOffset;
  }while(true);
  return result;
}
/**
 * Read-only binding for the already-created original commissioning programme.
 * reader is its actual Store or ResearchWorkspaceClient, not a second source store.
 * On resume, pass the original pinned revision or reuse the saved complete case.
 */
export async function bindRiskOfBiasStudyCase({
  reader,dossierId,questionId,eligibilityReviewId,studyId,studyVersion,occurrenceId,
  revision,extractionResultSetId,selectedResult,inputs,packet,signal,
}){
  need(reader&&typeof reader.riskOfBias==='function'&&typeof reader.extractionSourceValues==='function',
    'RISK_STUDY_CASE_ORIGINAL_READER_REQUIRED');
  need(Number.isSafeInteger(revision)&&revision>=1&&Number.isSafeInteger(studyVersion)&&studyVersion>=1,
    'RISK_STUDY_CASE_REVISION_REQUIRED');
  need(typeof extractionResultSetId==='string'&&extractionResultSetId.length&&
    /^o_[a-f0-9]{64}$/.test(occurrenceId??''),'RISK_STUDY_CASE_ORIGINAL_SELECTION_REQUIRED');
  need(inputs?.raw instanceof Uint8Array&&inputs.raw.length===ORIGINAL_STUDY.bytes&&
    digest(inputs.raw)===ORIGINAL_STUDY.sha256&&inputs.provenanceBytes instanceof Uint8Array&&
    inputs.provenanceBytes.length===ORIGINAL_STUDY.provenanceBytes&&
    digest(inputs.provenanceBytes)===ORIGINAL_STUDY.provenanceSha256,'RISK_STUDY_CASE_SOURCE_CHANGED');
  packet??=await loadRiskOfBiasStudyPacket();
  need(digest(Buffer.from(JSON.stringify(packet,null,2)+'\n'))===RISK_STUDY_CASE_PACKET_SHA256,
    'RISK_STUDY_CASE_PACKET_CHANGED');
  need(packet.schema==='sf88-risk-of-bias-original-study-case/v1'&&
    packet.selectedRowId===RISK_STUDY_CASE_ROW&&
    packet.source.sha256===ORIGINAL_STUDY.sha256&&packet.source.fileName===ORIGINAL_STUDY.fileName,
    'RISK_STUDY_CASE_PACKET_CHANGED');
  const [studies,results,sources]=await Promise.all([
    wholeSection(reader,dossierId,revision,'studies',{signal}),
    wholeSection(reader,dossierId,revision,'results',{signal}),
    wholeSection(reader,dossierId,revision,'sources',{signal}),
  ]);
  const candidates=studies.filter(value=>value.studyId===studyId&&value.studyVersion===studyVersion&&
    value.questionId===questionId&&value.record?.reviewId===eligibilityReviewId);
  need(candidates.length===1,'RISK_STUDY_CASE_STUDY_AMBIGUOUS');
  const study=candidates[0];
  need(study.studySha256===riskOfBiasDigest(study.record)&&study.occurrenceIds.includes(occurrenceId),
    'RISK_STUDY_CASE_STUDY_CHANGED');
  const choices=results.filter(value=>value.studyId===studyId&&value.questionId===questionId&&
    value.record?.resultSet?.id===extractionResultSetId&&value.record?.row?.id===RISK_STUDY_CASE_ROW&&
    (selectedResult?value.resultId===selectedResult.resultId&&value.resultVersion===selectedResult.resultVersion&&
      value.resultSha256===selectedResult.resultSha256:value.current===true)&&
    value.status==='RESOLVED'&&value.record?.status==='RESOLVED');
  need(choices.length===1,'RISK_STUDY_CASE_RESULT_AMBIGUOUS');
  const result=choices[0],original=result.record.row.context?.source;
  need(result.resultSha256===riskOfBiasDigest(result.record)&&result.resultVersion===result.record.revision&&
    original?.nctId===ORIGINAL_STUDY.nctId&&original.fileName===ORIGINAL_STUDY.fileName&&
    original.sha256===ORIGINAL_STUDY.sha256&&original.bytes===ORIGINAL_STUDY.bytes&&
    original.occurrenceId===occurrenceId&&original.questionId===questionId&&
    result.occurrenceIds.length===1&&result.occurrenceIds[0]===occurrenceId&&
    result.record.row.context.measurement?.pointer===
      '/resultsSection/outcomeMeasuresModule/outcomeMeasures/0/classes/0/categories/0/measurements/0',
    'RISK_STUDY_CASE_RESULT_SOURCE_CHANGED');
  const source=sources.filter(value=>value.occurrenceId===occurrenceId&&value.questionId===questionId);
  need(source.length===1&&source[0].files?.some(value=>value.name===ORIGINAL_STUDY.fileName&&
    value.sha256===ORIGINAL_STUDY.sha256&&value.bytes===ORIGINAL_STUDY.bytes),
    'RISK_STUDY_CASE_ORIGINAL_MEMBER_CHANGED');
  const passages=allPassages(packet),pointers=[...new Set(passages.map(value=>value.jsonPointer))];
  need(pointers.length>0&&pointers.every(value=>typeof value==='string'&&value.startsWith('/')),
    'RISK_STUDY_CASE_PASSAGE_POINTER_REQUIRED');
  signal?.throwIfAborted();
  const resolved=await reader.extractionSourceValues(dossierId,{revision,occurrenceId,
    fileName:ORIGINAL_STUDY.fileName,pointers});
  need(resolved.schema==='sf88-research-extraction-source-values/v1'&&resolved.dossierId===dossierId&&
    resolved.revision===revision&&resolved.occurrence?.occurrenceId===occurrenceId&&
    resolved.occurrence?.questionId===questionId&&Array.isArray(resolved.values)&&
    resolved.values.length===pointers.length,'RISK_STUDY_CASE_ORIGINAL_RESOLVER_CHANGED');
  const values=new Map(resolved.values.map(value=>[value.pointer,value]));
  need(values.size===pointers.length,'RISK_STUDY_CASE_POINTER_POPULATION_CHANGED');
  for(const passage of passages){
    const value=values.get(passage.jsonPointer);
    need(passage.fileName===ORIGINAL_STUDY.fileName&&value?.found===true&&value.kind==='json-pointer'&&
      value.file?.name===ORIGINAL_STUDY.fileName&&value.file.sha256===ORIGINAL_STUDY.sha256&&
      value.contentSha256===ORIGINAL_STUDY.sha256&&value.contentBytes===ORIGINAL_STUDY.bytes&&
      value.typedValue?.[0]==='str'&&typeof value.typedValue[1]==='string'&&
      typeof passage.quote==='string'&&passage.quote.length>0&&value.typedValue[1].includes(passage.quote),
      'RISK_STUDY_CASE_SOURCE_PASSAGE_CHANGED');
  }
  const protocol=riskOfBiasProtocol(packet.protocol);
  const reviewers=packet.reviewers.map(value=>boundContent(value,occurrenceId));
  const adjudication=boundContent(packet.adjudication,occurrenceId);
  for(const value of [...reviewers,adjudication])
    riskOfBiasContent(rawContent(value),{definition:protocol},{complete:true});
  const resultCase={
    schema:RISK_STUDY_CASE_SCHEMA,operationId:packet.operationId,
    dossierId,questionId,eligibilityReviewId,studyId,studyVersion,studySha256:study.studySha256,
    sourceRevision:revision,extractionResultSetId,
    packetSha256:RISK_STUDY_CASE_PACKET_SHA256,operator:clone(packet.operator),
    review:clone(packet.review),protocol,
    assessment:{...clone(packet.assessment),
      designBasis:packet.assessment.designBasis.map(value=>({...clone(value),occurrenceId}))},
    selectedResult:{resultId:result.resultId,resultVersion:result.resultVersion,
      resultSha256:result.resultSha256,sourceRecord:clone(result.record)},
    reviewers,adjudication,
    source:{...clone(packet.source),occurrenceId,sourceBinding:clone(resolved.occurrence)},
    sourcePassageCount:passages.length,sourcePointerCount:pointers.length,
    independence:clone(packet.independence),
  };
  resultCase.sha256=riskOfBiasDigest(resultCase);
  return resultCase;
}
