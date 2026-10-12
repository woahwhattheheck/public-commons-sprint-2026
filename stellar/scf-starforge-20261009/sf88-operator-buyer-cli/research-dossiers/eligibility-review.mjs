// MIT. Question-scoped eligibility reviews beside the original Research dossier.
// Reviewers are named local-workspace operators. Original retained editions and
// the immutable dossier history remain the source and receiving boundary.
import {digest,jsonBytes,need,object} from '../node/store.mjs';
import {sourceView} from './normalize.mjs';
import {RESEARCH_PAGE_LIMIT} from './workspace-contracts.mjs';

export const ELIGIBILITY_SCHEMA='sf88-research-eligibility-view/v1';
export const ELIGIBILITY_OPERATION_SCHEMA='sf88-research-eligibility-operation/v1';
export const ELIGIBILITY_ACTIONS=Object.freeze(['create-review','revise-protocol','create-workset',
  'decide','resolve','study-link','apply-outcomes','review-impact']);
export const ELIGIBILITY_SECTIONS=Object.freeze(['overview','reviews','queue','decisions',
  'resolutions','studies','impact','operations','occurrences']);
const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const eligibilityDigest=value=>digest(jsonBytes(canonical(value)));
const same=(a,b)=>eligibilityDigest(a)===eligibilityDigest(b);
const array=value=>Array.isArray(value)?value:[];
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const occurrence=value=>typeof value==='string'&&/^o_[a-f0-9]{64}$/.test(value);
const text=(value,code,max=20000,empty=false)=>{
  need(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0),code);return value;
};
const fields=(value,allowed,code)=>{
  need(object(value)&&Object.keys(value).every(key=>allowed.includes(key)),code);return value;
};
const identifier=(value,code='ELIGIBILITY_IDENTIFIER_INVALID')=>{
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value),code);return value;
};
const ids=(value,code,{empty=false,validate=identifier}={})=>{
  need(Array.isArray(value)&&(empty||value.length>0)&&new Set(value).size===value.length,code);
  value.forEach(item=>validate(item,code));return [...value];
};
const occurrenceIds=(value,code,empty=false)=>ids(value,code,{empty,validate:item=>need(occurrence(item),code)});
const actorInput=value=>{
  fields(value,['id','name'],'ELIGIBILITY_ACTOR_INVALID');
  return {id:identifier(value.id,'ELIGIBILITY_ACTOR_REQUIRED'),name:text(value.name,'ELIGIBILITY_ACTOR_NAME_REQUIRED',200)};
};
const byId=(values,id,code)=>{const value=values.find(item=>item.id===id);need(value,code);return value;};
const entityId=(prefix,state,request)=>prefix+'_'+eligibilityDigest({dossierId:state.id,requestId:request.requestId});
const serial=value=>JSON.parse(JSON.stringify(value));
const latestBy=(values,key)=>{const map=new Map();for(const value of values)map.set(key(value),value);return [...map.values()];};
const countBy=(values,key)=>{const counts={};for(const value of values){const name=key(value);counts[name]=(counts[name]??0)+1;}return counts;};

export function eligibilityInput(input){
  fields(input,['requestId','expectedRevision','actor','action','reviewId','data'],'ELIGIBILITY_FIELDS_INVALID');
  need(typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId),'ELIGIBILITY_REQUEST_REQUIRED');
  need(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=1,'EXPECTED_REVISION_REQUIRED');
  need(ELIGIBILITY_ACTIONS.includes(input.action),'ELIGIBILITY_ACTION_INVALID');
  need(object(input.data),'ELIGIBILITY_DATA_REQUIRED');
  const value={requestId:input.requestId,expectedRevision:input.expectedRevision,actor:actorInput(input.actor),
    action:input.action,...(input.reviewId!==undefined?{reviewId:identifier(input.reviewId)}:{}),data:clone(input.data)};
  need(input.action==='create-review'||value.reviewId,'ELIGIBILITY_REVIEW_REQUIRED');
  need(input.action!=='create-review'||input.reviewId===undefined,'ELIGIBILITY_CREATE_REVIEW_ID_INVALID');
  need(same(value,serial(value)),'ELIGIBILITY_JSON_REQUIRED');
  return value;
}

export function eligibilityProtocol(input){
  fields(input,['name','criteria','stages','reviewers','resolverIds','exclusionReasons','disagreementProcedure'],
    'ELIGIBILITY_PROTOCOL_FIELDS_INVALID');
  need(Array.isArray(input.criteria)&&input.criteria.length>0&&Array.isArray(input.stages)&&input.stages.length>0&&
    Array.isArray(input.reviewers)&&input.reviewers.length>0&&Array.isArray(input.exclusionReasons)&&
    input.exclusionReasons.length>0,'ELIGIBILITY_PROTOCOL_INCOMPLETE');
  const criteria=input.criteria.map(value=>{
    fields(value,['id','name','include','exclude'],'ELIGIBILITY_CRITERION_INVALID');
    return {id:identifier(value.id),name:text(value.name,'ELIGIBILITY_CRITERION_NAME_REQUIRED',240),
      include:text(value.include,'ELIGIBILITY_INCLUDE_RULE_REQUIRED'),exclude:text(value.exclude,'ELIGIBILITY_EXCLUDE_RULE_REQUIRED')};
  });
  const reviewers=input.reviewers.map(actorInput),exclusionReasons=input.exclusionReasons.map(value=>{
    fields(value,['id','label'],'ELIGIBILITY_EXCLUSION_REASON_INVALID');
    return {id:identifier(value.id),label:text(value.label,'ELIGIBILITY_EXCLUSION_LABEL_REQUIRED',1000)};
  });
  for(const rows of [criteria,reviewers,exclusionReasons])
    need(new Set(rows.map(value=>value.id)).size===rows.length,'ELIGIBILITY_PROTOCOL_DUPLICATE_ID');
  const stages=input.stages.map(value=>{
    fields(value,['id','name','criterionIds','reviewerIds','minimumDecisions','requireFullText'],'ELIGIBILITY_STAGE_INVALID');
    const criterionIds=ids(value.criterionIds,'ELIGIBILITY_STAGE_CRITERIA_REQUIRED');
    const reviewerIds=ids(value.reviewerIds,'ELIGIBILITY_STAGE_REVIEWERS_REQUIRED');
    need(criterionIds.every(id=>criteria.some(item=>item.id===id))&&
      reviewerIds.every(id=>reviewers.some(item=>item.id===id)),'ELIGIBILITY_STAGE_REFERENCE_INVALID');
    need(Number.isSafeInteger(value.minimumDecisions)&&value.minimumDecisions>=1&&
      value.minimumDecisions<=reviewerIds.length&&typeof value.requireFullText==='boolean','ELIGIBILITY_STAGE_PROCESS_INVALID');
    return {id:identifier(value.id),name:text(value.name,'ELIGIBILITY_STAGE_NAME_REQUIRED',240),
      criterionIds,reviewerIds,minimumDecisions:value.minimumDecisions,requireFullText:value.requireFullText};
  });
  need(new Set(stages.map(value=>value.id)).size===stages.length,'ELIGIBILITY_STAGE_DUPLICATE_ID');
  const resolverIds=ids(input.resolverIds,'ELIGIBILITY_RESOLVERS_REQUIRED');
  need(resolverIds.every(id=>reviewers.some(value=>value.id===id)),'ELIGIBILITY_RESOLVER_NOT_DECLARED');
  return {name:text(input.name,'ELIGIBILITY_PROTOCOL_NAME_REQUIRED',240),criteria,stages,reviewers,resolverIds,
    exclusionReasons,disagreementProcedure:text(input.disagreementProcedure,'ELIGIBILITY_DISAGREEMENT_PROCEDURE_REQUIRED')};
}

function occurrenceIndex(state,projected){
  need(projected instanceof Map,'ELIGIBILITY_RETAINED_PROJECTIONS_REQUIRED');
  const editions=new Map(state.editions.map(value=>[value.id,value])),index=new Map();
  for(const group of sourceView(state.editions,projected,state.selections)){
    for(const citation of group.citations){
      const edition=editions.get(citation.editionId);
      if(edition?.mode!=='retained')continue;
      index.set(citation.occurrenceId,serial({
        occurrenceId:citation.occurrenceId,editionId:edition.id,questionId:edition.questionId,key:citation.key,
        sourceId:group.id,title:citation.title,url:citation.url??'',doi:citation.doi??null,
        provider:edition.provider,sourceSha256:edition.raw.sha256,sourceBytes:edition.raw.bytes,
        contentDigest:citation.contentDigest,publishedAt:citation.publishedAt??null,
        sourceReference:edition.sourceReference??'',editionLabel:edition.label,
      }));
    }
  }
  return index;
}
function sourceFor(index,id,questionId){
  const value=index.get(id);
  need(value&&value.questionId===questionId,'ELIGIBILITY_RETAINED_QUESTION_SOURCE_REQUIRED');return clone(value);
}
function stateRecords(state){
  const model={reviews:[],protocols:[],workSets:[],decisions:[],resolutions:[],studyHistory:[],
    applications:[],impactReviews:[],operations:array(state.eligibilityEvents)};
  for(const event of model.operations){
    const result=event.result;
    if(result.review)model.reviews.push(result.review);
    if(result.protocol)model.protocols.push(result.protocol);
    if(result.workSet)model.workSets.push(result.workSet);
    if(result.decision)model.decisions.push(result.decision);
    if(result.resolution)model.resolutions.push(result.resolution);
    if(result.study)model.studyHistory.push(result.study);
    if(result.application)model.applications.push(result.application);
    if(result.impactReview)model.impactReviews.push(result.impactReview);
  }
  model.studies=latestBy(model.studyHistory,item=>item.id);
  return model;
}
const decisionKey=value=>[value.workSetId,value.occurrenceId,value.stageId,value.actor.id].join('\n');
const resolutionKey=value=>[value.workSetId,value.occurrenceId,value.stageId].join('\n');
function currentProtocol(model,reviewId){return model.protocols.filter(value=>value.reviewId===reviewId).at(-1);}
function registeredActor(protocol,actor,allowed){
  const registered=protocol.definition.reviewers.find(value=>value.id===actor.id);
  need(registered&&registered.name===actor.name&&allowed.includes(actor.id),'ELIGIBILITY_ACTOR_OUTSIDE_PROCESS');
}
function queueRows(state,model){
  const rows=[],active=latestBy(model.decisions,decisionKey),activeByStage=new Map();
  for(const decision of active){const key=resolutionKey(decision);if(!activeByStage.has(key))activeByStage.set(key,[]);activeByStage.get(key).push(decision);}
  const resolutions=new Map(latestBy(model.resolutions,resolutionKey).map(value=>[resolutionKey(value),value]));
  const selections=new Map(state.selections.map(value=>[value.occurrenceId,value]));
  for(const workSet of model.workSets){
    const protocol=byId(model.protocols,workSet.protocolId,'ELIGIBILITY_PROTOCOL_NOT_FOUND');
    const protocolCurrent=currentProtocol(model,workSet.reviewId)?.id===protocol.id;
    for(const source of workSet.sources){
      let preceding='include';
      for(const [stageIndex,stage]of protocol.definition.stages.entries()){
        const decisions=activeByStage.get([workSet.id,source.occurrenceId,stage.id].join('\n'))??[];
        const decisionIds=decisions.map(value=>value.id),resolution=resolutions.get([workSet.id,source.occurrenceId,stage.id].join('\n'))??null;
        const resolutionCurrent=Boolean(resolution&&same([...resolution.decisionIds].sort(),[...decisionIds].sort()));
        const missingReviewerIds=stage.reviewerIds.filter(id=>!decisions.some(value=>value.actor.id===id));
        const remainingDecisions=Math.max(0,stage.minimumDecisions-decisions.length);
        let status;
        if(preceding==='exclude')status='NOT_REQUIRED';
        else if(preceding!=='include')status='NOT_READY';
        else if(resolution&&!resolutionCurrent)status='RESOLUTION_STALE';
        else if(resolutionCurrent)status=({include:'RESOLVED_INCLUDE',exclude:'RESOLVED_EXCLUDE',
          awaiting_information:'AWAITING_INFORMATION'})[resolution.disposition];
        else if(decisions.some(value=>value.disposition==='unavailable'))status='UNAVAILABLE';
        else if(decisions.some(value=>value.disposition==='uncertain'))status='UNCERTAIN';
        else if(new Set(decisions.map(value=>value.disposition+':'+(value.exclusionReasonId??''))).size>1)status='CONFLICT';
        else if(remainingDecisions)status='MISSING_DECISIONS';
        else status='AGREEMENT';
        const selected=selections.get(source.occurrenceId);
        const study=model.studies.find(value=>value.reviewId===workSet.reviewId&&value.occurrenceIds.includes(source.occurrenceId));
        rows.push({...clone(source),id:workSet.id+':'+source.occurrenceId+':'+stage.id,reviewId:workSet.reviewId,
          workSetId:workSet.id,protocolId:protocol.id,stageId:stage.id,stageName:stage.name,stageIndex,
          requireFullText:stage.requireFullText,criterionIds:[...stage.criterionIds],reviewerIds:[...stage.reviewerIds],
          minimumDecisions:stage.minimumDecisions,missingReviewerIds,remainingDecisions,status,
          actionable:!['NOT_READY','NOT_REQUIRED','RESOLVED_INCLUDE','RESOLVED_EXCLUDE'].includes(status),
          decisionIds,decisions:clone(decisions),resolution:clone(resolution),resolutionCurrent,
          selected:selected?.selected??false,classification:selected?.classification??'unreviewed',
          studyId:study?.id??null,protocolCurrent});
        if(status==='RESOLVED_EXCLUDE'||status==='NOT_REQUIRED')preceding='exclude';
        else if(status==='RESOLVED_INCLUDE')preceding='include';
        else preceding='pending';
      }
    }
  }
  return rows;
}
function impactsFor(state,model,index,queue){
  const impacts=[];
  const add=value=>{
    const fingerprint=eligibilityDigest(value);
    const item={...value,id:'ei_'+fingerprint,fingerprint};
    const acknowledgement=model.impactReviews.filter(row=>row.impactId===item.id&&row.fingerprint===fingerprint).at(-1)??null;
    impacts.push({...item,status:acknowledgement?({reviewed:'REVIEWED',needs_review:'NEEDS_REVIEW',
      out_of_scope:'OUT_OF_SCOPE'})[acknowledgement.disposition]:'NEEDS_REVIEW',lastReview:clone(acknowledgement)});
  };
  for(const review of model.reviews){
    const protocol=currentProtocol(model,review.id),question=state.questions.find(value=>value.id===review.questionId);
    const sets=model.workSets.filter(value=>value.reviewId===review.id);
    if(protocol&&question&&question.text!==protocol.question.text)add({reviewId:review.id,workSetId:null,
      kind:'question_changed',title:'Research question changed',questionId:review.questionId,
      protocolId:protocol.id,before:protocol.question.text,after:question.text,occurrenceIds:[]});
    for(const workSet of sets.filter(value=>value.protocolId!==protocol?.id)){
      add({reviewId:review.id,workSetId:workSet.id,kind:'protocol_changed',title:'Work set uses a previous protocol',
        questionId:review.questionId,protocolId:workSet.protocolId,currentProtocolId:protocol.id,
        occurrenceIds:workSet.sources.map(value=>value.occurrenceId)});
    }
    const latestSet=sets.filter(value=>value.protocolId===protocol?.id).at(-1);
    if(latestSet){
      for(const edition of state.editions.filter(value=>value.mode==='retained'&&value.questionId===review.questionId&&
        !latestSet.sourceEditionIdsAtCreation.includes(value.id))){
        add({reviewId:review.id,workSetId:latestSet.id,kind:'source_added',title:'New retained source edition',
          questionId:review.questionId,protocolId:protocol.id,editionId:edition.id,sourceSha256:edition.raw.sha256,
          label:edition.label,occurrenceIds:[...index.values()].filter(value=>value.editionId===edition.id).map(value=>value.occurrenceId)});
      }
    }
    const applied=latestBy(model.applications.filter(value=>value.reviewId===review.id).flatMap(application=>
      application.outcomes.map(outcome=>({...outcome,workSetId:application.workSetId,applicationId:application.id}))),
      value=>value.occurrenceId);
    for(const outcome of applied){
      const selection=state.selections.find(value=>value.occurrenceId===outcome.occurrenceId)??null;
      const originalResolution=model.resolutions.find(value=>value.id===outcome.resolutionId);
      const row=queue.find(value=>value.workSetId===outcome.workSetId&&value.occurrenceId===outcome.occurrenceId&&
        value.stageId===originalResolution?.stageId);
      if(!row||!row.resolutionCurrent||row.resolution?.id!==outcome.resolutionId||!['RESOLVED_INCLUDE','RESOLVED_EXCLUDE'].includes(row.status)||
        !row.protocolCurrent||!same(selection,outcome.after)){
        add({reviewId:review.id,workSetId:outcome.workSetId,kind:'applied_outcome_changed',
          title:'Applied outcome needs reconsideration',questionId:review.questionId,
          applicationId:outcome.applicationId,resolutionId:outcome.resolutionId,
          occurrenceIds:[outcome.occurrenceId],appliedSelection:outcome.after,currentSelection:clone(selection),
          currentResolutionId:row?.resolution?.id??null,resolutionCurrent:row?.resolutionCurrent??false,
          protocolCurrent:row?.protocolCurrent??false});
      }
    }
  }
  return impacts;
}
export function eligibilityModel(state,projected){
  const model=stateRecords(state),occurrences=occurrenceIndex(state,projected);
  model.queue=queueRows(state,model);model.impact=impactsFor(state,model,occurrences,model.queue);
  return {...model,occurrences};
}

function protocolEdition(state,model,review,definition,request,createdAt,reason){
  const previous=currentProtocol(model,review.id);
  const question=byId(state.questions,review.questionId,'QUESTION_NOT_FOUND');
  return {id:entityId('ep',state,request),reviewId:review.id,edition:(previous?.edition??0)+1,
    question:{id:question.id,text:question.text},definition:eligibilityProtocol(definition),
    supersedes:previous?.id??null,reason,createdAt,actor:clone(request.actor),originalRevision:state.revision};
}
function workSetContext(model,reviewId,id){
  const workSet=byId(model.workSets,id,'ELIGIBILITY_WORKSET_NOT_FOUND');
  need(workSet.reviewId===reviewId,'ELIGIBILITY_WORKSET_REVIEW_MISMATCH');
  const protocol=byId(model.protocols,workSet.protocolId,'ELIGIBILITY_PROTOCOL_NOT_FOUND');
  return {workSet,protocol};
}
function stageContext(model,reviewId,data){
  const {workSet,protocol}=workSetContext(model,reviewId,data.workSetId);
  const source=workSet.sources.find(value=>value.occurrenceId===data.occurrenceId);
  need(source,'ELIGIBILITY_SOURCE_OUTSIDE_WORKSET');
  const stage=byId(protocol.definition.stages,data.stageId,'ELIGIBILITY_STAGE_NOT_FOUND');
  const row=model.queue.find(value=>value.workSetId===workSet.id&&value.occurrenceId===source.occurrenceId&&
    value.stageId===stage.id);
  need(row&&!['NOT_READY','NOT_REQUIRED'].includes(row.status),'ELIGIBILITY_PRECEDING_STAGE_UNRESOLVED');
  return {workSet,protocol,source,stage,row};
}
function basisInput(value,index,questionId){
  fields(value,['availability','occurrenceIds','locator','note'],'ELIGIBILITY_BASIS_INVALID');
  need(['available','unavailable','not_required'].includes(value.availability),'ELIGIBILITY_AVAILABILITY_INVALID');
  const occurrenceIdsValue=occurrenceIds(value.occurrenceIds??[],'ELIGIBILITY_BASIS_SOURCES_INVALID',true);
  const locator=text(value.locator??'','ELIGIBILITY_BASIS_LOCATOR_INVALID',4000,true);
  const note=text(value.note??'','ELIGIBILITY_BASIS_NOTE_INVALID',20000,true);
  if(value.availability==='available')need(occurrenceIdsValue.length>0&&locator.trim().length>0,'ELIGIBILITY_AVAILABLE_BASIS_REQUIRED');
  const sources=occurrenceIdsValue.map(id=>sourceFor(index,id,questionId));
  return {basis:{availability:value.availability,occurrenceIds:occurrenceIdsValue,locator,note},sources};
}
function excludedReason(protocol,disposition,value){
  if(disposition==='exclude'){
    need(protocol.definition.exclusionReasons.some(item=>item.id===value),'ELIGIBILITY_EXCLUSION_REASON_REQUIRED');
    return value;
  }
  need(value===undefined||value===null,'ELIGIBILITY_EXCLUSION_REASON_UNEXPECTED');return null;
}
function applyEligibilityAction(state,model,request,createdAt){
  const data=request.data,actor=clone(request.actor),common={createdAt,actor,originalRevision:state.revision,revision:state.revision+1};
  if(request.action==='create-review'){
    fields(data,['questionId','name','description','protocol'],'ELIGIBILITY_CREATE_FIELDS_INVALID');
    const question=byId(state.questions,data.questionId,'QUESTION_NOT_FOUND');
    const review={id:entityId('er',state,request),questionId:question.id,
      name:text(data.name,'ELIGIBILITY_REVIEW_NAME_REQUIRED',240),
      description:text(data.description??'','ELIGIBILITY_REVIEW_DESCRIPTION_INVALID',20000,true),
      createdAt,createdBy:actor,originalRevision:state.revision};
    return {review,protocol:protocolEdition(state,model,review,data.protocol,request,createdAt,'Initial protocol')};
  }
  const review=byId(model.reviews,request.reviewId,'ELIGIBILITY_REVIEW_NOT_FOUND');
  const current=currentProtocol(model,review.id);
  if(request.action==='revise-protocol'){
    fields(data,['protocol','reason'],'ELIGIBILITY_PROTOCOL_CHANGE_FIELDS_INVALID');
    const reason=text(data.reason,'ELIGIBILITY_PROTOCOL_CHANGE_REASON_REQUIRED');
    const protocol=protocolEdition(state,model,review,data.protocol,request,createdAt,reason);
    need(!same(protocol.definition,current.definition)||protocol.question.text!==current.question.text,
      'ELIGIBILITY_PROTOCOL_UNCHANGED');
    return {protocol};
  }
  if(request.action==='create-workset'){
    fields(data,['protocolId','name','occurrenceIds','reason'],'ELIGIBILITY_WORKSET_FIELDS_INVALID');
    const protocol=byId(model.protocols,data.protocolId,'ELIGIBILITY_PROTOCOL_NOT_FOUND');
    need(protocol.reviewId===review.id,'ELIGIBILITY_PROTOCOL_REVIEW_MISMATCH');
    const selected=occurrenceIds(data.occurrenceIds,'ELIGIBILITY_WORKSET_SOURCES_REQUIRED');
    const sources=selected.map(id=>sourceFor(model.occurrences,id,review.questionId));
    return {workSet:{id:entityId('ew',state,request),reviewId:review.id,questionId:review.questionId,
      name:text(data.name,'ELIGIBILITY_WORKSET_NAME_REQUIRED',240),protocolId:protocol.id,sources,
      sourceEditionIdsAtCreation:state.editions.filter(value=>value.questionId===review.questionId&&
        value.mode==='retained').map(value=>value.id).sort(),sourceRevision:state.revision,
      reason:text(data.reason,'ELIGIBILITY_WORKSET_REASON_REQUIRED'),...common}};
  }
  if(request.action==='decide'){
    fields(data,['workSetId','occurrenceId','stageId','disposition','criterionAnswers','exclusionReasonId','basis','reason','supersedes'],
      'ELIGIBILITY_DECISION_FIELDS_INVALID');
    const {workSet,protocol,source,stage,row}=stageContext(model,review.id,data);
    registeredActor(protocol,actor,stage.reviewerIds);
    need(['include','exclude','uncertain','unavailable'].includes(data.disposition),'ELIGIBILITY_DECISION_INVALID');
    need(Array.isArray(data.criterionAnswers),'ELIGIBILITY_CRITERION_ANSWERS_REQUIRED');
    const answers=data.criterionAnswers.map(value=>{
      fields(value,['criterionId','assessment','note'],'ELIGIBILITY_CRITERION_ANSWER_INVALID');
      need(stage.criterionIds.includes(value.criterionId)&&['meets','does_not_meet','unclear','not_applicable'].includes(value.assessment),
        'ELIGIBILITY_CRITERION_ASSESSMENT_INVALID');
      return {criterionId:value.criterionId,assessment:value.assessment,
        note:text(value.note??'','ELIGIBILITY_CRITERION_NOTE_INVALID',20000,true)};
    });
    need(new Set(answers.map(value=>value.criterionId)).size===answers.length,'ELIGIBILITY_CRITERION_ANSWER_DUPLICATE');
    if(['include','exclude'].includes(data.disposition)){
      need(answers.length===stage.criterionIds.length,'ELIGIBILITY_ALL_CRITERIA_REQUIRED');
      if(data.disposition==='include')need(answers.every(value=>['meets','not_applicable'].includes(value.assessment)),
        'ELIGIBILITY_INCLUDE_CRITERIA_UNRESOLVED');
      else need(answers.some(value=>value.assessment==='does_not_meet'),'ELIGIBILITY_EXCLUSION_CRITERION_REQUIRED');
    }
    const {basis,sources:basisSources}=basisInput(data.basis,model.occurrences,review.questionId);
    if(data.disposition==='unavailable')need(basis.availability==='unavailable','ELIGIBILITY_UNAVAILABLE_BASIS_REQUIRED');
    if(['include','exclude'].includes(data.disposition)){
      need(basis.availability!=='unavailable','ELIGIBILITY_UNAVAILABLE_SOURCE_UNRESOLVED');
      if(stage.requireFullText)need(basis.availability==='available','ELIGIBILITY_FULL_TEXT_BASIS_REQUIRED');
    }
    const previous=row.decisions.find(value=>value.actor.id===actor.id)??null;
    need(previous?data.supersedes===previous.id:data.supersedes===undefined||data.supersedes===null,
      'ELIGIBILITY_CORRECTION_REFERENCE_REQUIRED');
    return {decision:{id:entityId('ed',state,request),reviewId:review.id,questionId:review.questionId,
      workSetId:workSet.id,protocolId:protocol.id,occurrenceId:source.occurrenceId,stageId:stage.id,
      disposition:data.disposition,criterionAnswers:answers,
      exclusionReasonId:excludedReason(protocol,data.disposition,data.exclusionReasonId),
      basis,basisSources,source:clone(source),supersedes:previous?.id??null,
      reason:text(data.reason,'ELIGIBILITY_DECISION_REASON_REQUIRED'),...common}};
  }
  if(request.action==='resolve'){
    fields(data,['workSetId','occurrenceId','stageId','mode','disposition','decisionIds','exclusionReasonId','reason'],
      'ELIGIBILITY_RESOLUTION_FIELDS_INVALID');
    const {workSet,protocol,source,stage,row}=stageContext(model,review.id,data);
    registeredActor(protocol,actor,protocol.definition.resolverIds);
    need(['consensus','adjudication'].includes(data.mode)&&
      ['include','exclude','awaiting_information'].includes(data.disposition),'ELIGIBILITY_RESOLUTION_INVALID');
    const selected=ids(data.decisionIds,'ELIGIBILITY_RESOLUTION_DECISIONS_REQUIRED');
    need(same([...selected].sort(),[...row.decisionIds].sort()),'ELIGIBILITY_CURRENT_DECISIONS_REQUIRED');
    need(row.decisions.length>=stage.minimumDecisions,'ELIGIBILITY_MINIMUM_DECISIONS_REQUIRED');
    const exclusionReasonId=excludedReason(protocol,data.disposition,data.exclusionReasonId);
    if(data.mode==='consensus'&&data.disposition!=='awaiting_information'){
      need(row.decisions.every(value=>value.disposition===data.disposition&&
        value.exclusionReasonId===exclusionReasonId),'ELIGIBILITY_CONSENSUS_DISAGREEMENT');
    }
    if(stage.requireFullText&&data.disposition!=='awaiting_information')
      need(row.decisions.some(value=>value.basis.availability==='available'&&value.basisSources.length>0),
        'ELIGIBILITY_FULL_TEXT_BASIS_REQUIRED');
    return {resolution:{id:entityId('ez',state,request),reviewId:review.id,questionId:review.questionId,
      workSetId:workSet.id,protocolId:protocol.id,occurrenceId:source.occurrenceId,stageId:stage.id,
      mode:data.mode,disposition:data.disposition,decisionIds:selected,exclusionReasonId,
      supersedes:row.resolution?.id??null,source:clone(source),
      reason:text(data.reason,'ELIGIBILITY_RESOLUTION_REASON_REQUIRED'),...common}};
  }
  if(request.action==='study-link'){
    fields(data,['studyId','name','occurrenceIds','reason','evidence'],'ELIGIBILITY_STUDY_FIELDS_INVALID');
    registeredActor(current,actor,current.definition.reviewers.map(value=>value.id));
    const selected=occurrenceIds(data.occurrenceIds,'ELIGIBILITY_STUDY_REPORTS_REQUIRED');
    const sources=selected.map(id=>sourceFor(model.occurrences,id,review.questionId));
    const previous=data.studyId?byId(model.studies,data.studyId,'ELIGIBILITY_STUDY_NOT_FOUND'):null;
    need(!previous||previous.reviewId===review.id,'ELIGIBILITY_STUDY_REVIEW_MISMATCH');
    need(!model.studies.some(value=>value.reviewId===review.id&&value.id!==previous?.id&&
      value.occurrenceIds.some(id=>selected.includes(id))),'ELIGIBILITY_REPORT_ALREADY_LINKED');
    need(Array.isArray(data.evidence)&&data.evidence.length>0,'ELIGIBILITY_STUDY_SOURCE_EVIDENCE_REQUIRED');
    const evidence=data.evidence.map(value=>{
      fields(value,['occurrenceId','locator','note'],'ELIGIBILITY_STUDY_EVIDENCE_INVALID');
      need(selected.includes(value.occurrenceId),'ELIGIBILITY_STUDY_EVIDENCE_OUTSIDE_REPORTS');
      return {occurrenceId:value.occurrenceId,locator:text(value.locator,'ELIGIBILITY_STUDY_LOCATOR_REQUIRED',4000),
        note:text(value.note,'ELIGIBILITY_STUDY_EVIDENCE_NOTE_REQUIRED')};
    });
    need(selected.every(id=>evidence.some(value=>value.occurrenceId===id)),'ELIGIBILITY_STUDY_EACH_REPORT_EVIDENCE_REQUIRED');
    return {study:{id:previous?.id??entityId('es',state,request),reviewId:review.id,questionId:review.questionId,
      version:(previous?.version??0)+1,name:text(data.name,'ELIGIBILITY_STUDY_NAME_REQUIRED',240),
      occurrenceIds:selected,sources,evidence,reason:text(data.reason,'ELIGIBILITY_STUDY_LINK_REASON_REQUIRED'),
      previous:previous?{version:previous.version,sha256:eligibilityDigest(previous)}:null,...common}};
  }
  if(request.action==='apply-outcomes'){
    fields(data,['workSetId','outcomes','reason'],'ELIGIBILITY_APPLY_FIELDS_INVALID');
    const {workSet,protocol}=workSetContext(model,review.id,data.workSetId);
    registeredActor(protocol,actor,protocol.definition.resolverIds);
    need(current.id===protocol.id,'ELIGIBILITY_CURRENT_PROTOCOL_REQUIRED');
    need(state.questions.find(value=>value.id===review.questionId)?.text===protocol.question.text,
      'ELIGIBILITY_QUESTION_CHANGED');
    need(Array.isArray(data.outcomes)&&data.outcomes.length>0,'ELIGIBILITY_OUTCOMES_REQUIRED');
    need(new Set(data.outcomes.map(value=>value?.occurrenceId)).size===data.outcomes.length,'ELIGIBILITY_OUTCOME_DUPLICATE');
    const outcomes=[];
    for(const value of data.outcomes){
      fields(value,['occurrenceId','resolutionId','classification','note'],'ELIGIBILITY_OUTCOME_FIELDS_INVALID');
      const source=workSet.sources.find(item=>item.occurrenceId===value.occurrenceId);
      need(source,'ELIGIBILITY_SOURCE_OUTSIDE_WORKSET');
      const row=model.queue.find(item=>item.workSetId===workSet.id&&item.occurrenceId===source.occurrenceId&&
        item.resolution?.id===value.resolutionId);
      need(row?.resolutionCurrent&&['RESOLVED_INCLUDE','RESOLVED_EXCLUDE'].includes(row.status),
        'ELIGIBILITY_FINAL_RESOLUTION_REQUIRED');
      need(row.status==='RESOLVED_EXCLUDE'||row.stageIndex===protocol.definition.stages.length-1,
        'ELIGIBILITY_FINAL_STAGE_REQUIRED');
      need(value.classification===undefined||['supports','contradicts','background','unreviewed'].includes(value.classification),
        'CLASSIFICATION_INVALID');
      if(value.note!==undefined)text(value.note,'EVIDENCE_NOTE_INVALID',100000,true);
      let saved=state.selections.find(item=>item.occurrenceId===source.occurrenceId);
      const before=saved?clone(saved):null;
      if(!saved){
        saved={occurrenceId:source.occurrenceId,editionId:source.editionId,questionId:source.questionId,key:source.key};
        state.selections.push(saved);
      }
      Object.assign(saved,{selected:row.resolution.disposition==='include',
        classification:value.classification??saved.classification??'unreviewed',
        note:value.note??saved.note??'',updatedAt:createdAt});
      outcomes.push({occurrenceId:source.occurrenceId,resolutionId:row.resolution.id,
        disposition:row.resolution.disposition,exclusionReasonId:row.resolution.exclusionReasonId,
        before,after:clone(saved)});
    }
    return {application:{id:entityId('ea',state,request),reviewId:review.id,questionId:review.questionId,
      workSetId:workSet.id,protocolId:protocol.id,outcomes,reason:text(data.reason,'ELIGIBILITY_APPLY_REASON_REQUIRED'),...common}};
  }
  fields(data,['impactId','workSetId','reason','disposition'],'ELIGIBILITY_IMPACT_FIELDS_INVALID');
  const impact=byId(model.impact,data.impactId,'ELIGIBILITY_IMPACT_NOT_FOUND');
  need(impact.reviewId===review.id,'ELIGIBILITY_IMPACT_REVIEW_MISMATCH');
  registeredActor(current,actor,current.definition.reviewers.map(value=>value.id));
  need(['reviewed','needs_review','out_of_scope'].includes(data.disposition),'ELIGIBILITY_IMPACT_DISPOSITION_INVALID');
  if(data.workSetId!==undefined)workSetContext(model,review.id,data.workSetId);
  return {impactReview:{id:entityId('eiq',state,request),reviewId:review.id,impactId:impact.id,
    fingerprint:impact.fingerprint,kind:impact.kind,workSetId:data.workSetId??impact.workSetId??null,
    disposition:data.disposition,reason:text(data.reason,'ELIGIBILITY_IMPACT_REASON_REQUIRED'),
    impact:clone(impact),...common}};
}

/** One original request produces one append-only event and one dossier commit. */
export function recordEligibilityOperation(state,projected,input,createdAt){
  const request=eligibilityInput(input);
  need(state.revision===request.expectedRevision,'REVISION_CONFLICT');
  need(typeof createdAt==='string'&&Number.isFinite(Date.parse(createdAt)),'ELIGIBILITY_TIME_INVALID');
  need(!array(state.eligibilityEvents).some(value=>value.requestId===request.requestId),'ELIGIBILITY_REQUEST_ALREADY_RECORDED');
  const originalRevisionSha256=digest(jsonBytes(state)),model=eligibilityModel(state,projected);
  const result=applyEligibilityAction(state,model,request,createdAt);
  const payload={schema:ELIGIBILITY_OPERATION_SCHEMA,id:entityId('eo',state,request),dossierId:state.id,
    requestId:request.requestId,requestSha256:eligibilityDigest(request),request:clone(request),
    reviewId:result.review?.id??request.reviewId,action:request.action,actor:clone(request.actor),createdAt,
    originalRevision:state.revision,revision:state.revision+1,originalRevisionSha256,result};
  const operation={...payload,sha256:eligibilityDigest(payload)};
  state.eligibilityEvents=[...array(state.eligibilityEvents),operation];return operation;
}

export function eligibilityOverview(model,{reviewId,workSetId}={}){
  const reviews=model.reviews.filter(value=>!reviewId||value.id===reviewId);
  const reviewIds=new Set(reviews.map(value=>value.id));
  const workSets=model.workSets.filter(value=>reviewIds.has(value.reviewId)&&(!workSetId||value.id===workSetId));
  const workSetIds=new Set(workSets.map(value=>value.id));
  const sources=latestBy(workSets.flatMap(value=>value.sources),value=>value.occurrenceId);
  const sourceIds=new Set(sources.map(value=>value.occurrenceId));
  const queue=model.queue.filter(value=>workSetIds.has(value.workSetId));
  const studies=model.studies.filter(value=>reviewIds.has(value.reviewId)&&value.occurrenceIds.some(id=>sourceIds.has(id)));
  const linked=new Set(studies.flatMap(value=>value.occurrenceIds));
  const stageGroups=new Map();
  for(const row of queue){
    const key=row.workSetId+'\n'+row.stageId;
    if(!stageGroups.has(key))stageGroups.set(key,{workSetId:row.workSetId,protocolId:row.protocolId,
      stageId:row.stageId,stageName:row.stageName,rows:[]});
    stageGroups.get(key).rows.push(row);
  }
  const finalRows=queue.filter(value=>value.resolutionCurrent&&
    (value.status==='RESOLVED_EXCLUDE'||value.status==='RESOLVED_INCLUDE'&&
      value.stageIndex===model.protocols.find(item=>item.id===value.protocolId).definition.stages.length-1));
  return {reviewCount:reviews.length,protocolCount:model.protocols.filter(value=>reviewIds.has(value.reviewId)).length,
    workSetCount:workSets.length,reportOccurrenceCount:sources.length,
    retainedEditionCount:new Set(sources.map(value=>value.editionId)).size,
    confirmedStudyCount:studies.length,ungroupedReportCount:sources.filter(value=>!linked.has(value.occurrenceId)).length,
    decisionCount:model.decisions.filter(value=>workSetIds.has(value.workSetId)).length,
    resolutionCount:model.resolutions.filter(value=>workSetIds.has(value.workSetId)).length,
    appliedOutcomeCount:model.applications.filter(value=>workSetIds.has(value.workSetId)).reduce((n,value)=>n+value.outcomes.length,0),
    unresolvedImpactCount:model.impact.filter(value=>reviewIds.has(value.reviewId)&&value.status==='NEEDS_REVIEW'&&
      (!workSetId||!value.workSetId||value.workSetId===workSetId)).length,
    queueAssignmentCount:queue.length,statusCounts:countBy(queue,value=>value.status),
    includedReportAssignments:finalRows.filter(value=>value.status==='RESOLVED_INCLUDE').length,
    excludedReportAssignments:finalRows.filter(value=>value.status==='RESOLVED_EXCLUDE').length,
    exclusionReasonCounts:countBy(finalRows.filter(value=>value.status==='RESOLVED_EXCLUDE'),
      value=>value.resolution.exclusionReasonId),
    stageCounts:[...stageGroups.values()].map(({rows,...stage})=>({...stage,reports:rows.length,
      statusCounts:countBy(rows,value=>value.status)})),
    units:{reportOccurrenceCount:'Distinct retained report occurrences in selected work sets',
      confirmedStudyCount:'Explicit operator-linked study groups represented in those reports',
      decisionCount:'All recorded decisions, including superseded corrections',
      appliedOutcomeCount:'Recorded application events; a report may be applied again',
      statusCounts:'Work-set/report/stage assignments; overlapping work sets count separately',
      exclusionReasonCounts:'Currently resolved excluded work-set/report assignments'}};
}
function selectedModel(state,model,{reviewId,workSetId}={}){
  const review=reviewId?byId(model.reviews,reviewId,'ELIGIBILITY_REVIEW_NOT_FOUND'):null;
  const chosen=workSetId?byId(model.workSets,workSetId,'ELIGIBILITY_WORKSET_NOT_FOUND'):null;
  need(!review||!chosen||chosen.reviewId===review.id,'ELIGIBILITY_WORKSET_REVIEW_MISMATCH');
  reviewId=review?.id??chosen?.reviewId;
  const reviews=model.reviews.filter(value=>!reviewId||value.id===reviewId);
  const reviewIds=new Set(reviews.map(value=>value.id));
  const workSets=model.workSets.filter(value=>reviewIds.has(value.reviewId)&&(!workSetId||value.id===workSetId));
  const workSetIds=new Set(workSets.map(value=>value.id));
  const questionIds=new Set(reviews.map(value=>value.questionId));
  const workFilter=value=>workSetIds.has(value.workSetId);
  const activeDecisionIds=new Set(latestBy(model.decisions,decisionKey).map(value=>value.id));
  const protocols=model.protocols.filter(value=>reviewIds.has(value.reviewId));
  const studies=model.studies.filter(value=>reviewIds.has(value.reviewId)&&(!chosen||
    value.occurrenceIds.some(id=>chosen.sources.some(source=>source.occurrenceId===id))));
  const selections=new Map(state.selections.map(value=>[value.occurrenceId,value]));
  const occurrences=[...model.occurrences.values()].filter(value=>!reviewId||questionIds.has(value.questionId)).map(value=>({
    ...clone(value),selected:selections.get(value.occurrenceId)?.selected??false,
    classification:selections.get(value.occurrenceId)?.classification??'unreviewed',
    workSetIds:model.workSets.filter(set=>reviewIds.has(set.reviewId)&&set.sources.some(source=>
      source.occurrenceId===value.occurrenceId)).map(set=>set.id)}));
  return {reviewId:reviewId??null,workSetId:workSetId??null,
    overview:eligibilityOverview(model,{reviewId,workSetId}),reviews:reviews.map(value=>({...clone(value),
      currentProtocolId:currentProtocol(model,value.id)?.id??null,
      questionText:state.questions.find(question=>question.id===value.questionId)?.text??'',
      protocolCount:protocols.filter(protocol=>protocol.reviewId===value.id).length,
      workSetCount:workSets.filter(set=>set.reviewId===value.id).length})),
    protocols,workSets,queue:model.queue.filter(workFilter),decisions:model.decisions.filter(workFilter).map(value=>({
      ...clone(value),active:activeDecisionIds.has(value.id)})),
    resolutions:model.resolutions.filter(workFilter).map(value=>({...clone(value),
      current:model.queue.some(row=>row.resolution?.id===value.id&&row.resolutionCurrent&&
        ['RESOLVED_INCLUDE','RESOLVED_EXCLUDE','AWAITING_INFORMATION'].includes(row.status))})),
    studies,studyHistory:model.studyHistory.filter(value=>reviewIds.has(value.reviewId)),
    applications:model.applications.filter(workFilter),impact:model.impact.filter(value=>reviewIds.has(value.reviewId)&&
      (!workSetId||!value.workSetId||value.workSetId===workSetId)),
    operations:model.operations.filter(value=>reviewIds.has(value.reviewId)&&(!workSetId||
      !value.request.data.workSetId||value.request.data.workSetId===workSetId)),
    occurrences};
}
export function eligibilityPage(state,model,{reviewId,workSetId,section='overview',offset=0,limit=30}={}){
  need([...ELIGIBILITY_SECTIONS,'occurrences'].includes(section),'ELIGIBILITY_SECTION_INVALID');
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=RESEARCH_PAGE_LIMIT,
    'ELIGIBILITY_PAGE_INVALID');
  const selected=selectedModel(state,model,{reviewId,workSetId});
  const values=section==='overview'?[]:selected[section];
  need(Array.isArray(values)&&offset<=values.length,'ELIGIBILITY_PAGE_INVALID');
  const protocol=selected.workSetId?
    selected.protocols.find(value=>value.id===selected.workSets[0].protocolId):selected.protocols.at(-1);
  const items=values.slice(offset,offset+limit);
  return {schema:ELIGIBILITY_SCHEMA,dossier:{id:state.id,title:state.title,revision:state.revision},
    reviewId:selected.reviewId,workSetId:selected.workSetId,section,overview:selected.overview,
    protocols:clone(selected.protocols),workSets:clone(selected.workSets),
    reviewers:clone(protocol?.definition.reviewers??[]),exclusionReasons:clone(protocol?.definition.exclusionReasons??[]),
    items:clone(items),offset,limit,total:values.length,nextOffset:offset+items.length<values.length?offset+items.length:null};
}
export function eligibilityReport(state,model,options={}){
  const selected=selectedModel(state,model,options);
  return {schema:'sf88-research-eligibility-report/v1',dossier:{id:state.id,title:state.title,revision:state.revision},
    asOf:state.updatedAt,...serial(selected),
    operatingMethod:{reviewerIdentity:'Named operators in the original authenticated local workspace',
      studyIdentity:'Explicit retained report links and the recorded operator rationale',
      decisions:'Separate named decisions; corrections and resolutions append to original dossier history',
      sourceIdentity:'Question, edition, occurrence, original retained-byte SHA-256 and normalized content digest',
      counts:'Review flow counts use the units supplied in overview.units',
      receiving:'The complete editable dossier, original documents and every revision use the original portable export'}};
}
const csvCell=value=>{
  let output=value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):String(value);
  if(/^[\s]*[=+\-@]/u.test(output)||/^[\t\r\n]/u.test(output))output="'"+output;
  return '"'+output.replace(/"/g,'""')+'"';
};
export function eligibilityExport(state,model,{reviewId,workSetId,format='json',section='queue'}={}){
  need(['json','csv'].includes(format),'EXPORT_FORMAT_INVALID');
  need(['queue','decisions','resolutions','studies','impact','operations','occurrences'].includes(section),
    'ELIGIBILITY_EXPORT_SECTION_INVALID');
  const report=eligibilityReport(state,model,{reviewId,workSetId});
  if(format==='json')return {filename:state.id+'-r'+state.revision+'.eligibility.json',revision:state.revision,
    contentType:'application/json; charset=utf-8',body:JSON.stringify(report,null,2)+'\n'};
  const rows=report[section],headers=[...new Set(rows.flatMap(value=>Object.keys(value)))];
  const body=(headers.length?[headers.map(csvCell).join(','),...rows.map(row=>headers.map(key=>csvCell(row[key])).join(','))]:
    ['"section","dossierId","revision","rowCount"',[section,state.id,state.revision,0].map(csvCell).join(',')]).join('\r\n')+'\r\n';
  return {filename:state.id+'-r'+state.revision+'.eligibility-'+section+'.csv',revision:state.revision,
    contentType:'text/csv; charset=utf-8',body};
}
function validateSourceBinding(source,editions,knownOccurrences){
  need(object(source)&&occurrence(source.occurrenceId),'PORTABLE_ELIGIBILITY_SOURCE_INVALID');
  const edition=editions.get(source.editionId);
  need(edition?.mode==='retained'&&source.questionId===edition.questionId&&
    source.sourceSha256===edition.raw.sha256&&source.sourceBytes===edition.raw.bytes&&
    typeof source.key==='string'&&source.occurrenceId==='o_'+digest(Buffer.from(edition.id+'\n'+source.key))&&
    knownOccurrences.get(source.occurrenceId)===source.questionId&&hash(source.contentDigest),
    'PORTABLE_ELIGIBILITY_SOURCE_BINDING_INVALID');
}
export function validateEligibilityState(state,editions,knownOccurrences){
  need(state.eligibilityEvents===undefined||Array.isArray(state.eligibilityEvents),'PORTABLE_ELIGIBILITY_INVALID');
  const seen=new Set(),requests=new Set();
  for(const operation of state.eligibilityEvents??[]){
    need(object(operation)&&operation.schema===ELIGIBILITY_OPERATION_SCHEMA&&object(operation.result)&&
      operation.dossierId===state.id&&Number.isSafeInteger(operation.originalRevision)&&operation.originalRevision>=1&&
      operation.revision===operation.originalRevision+1&&operation.revision<=state.revision&&
      hash(operation.originalRevisionSha256)&&typeof operation.createdAt==='string'&&
      Number.isFinite(Date.parse(operation.createdAt)),'PORTABLE_ELIGIBILITY_OPERATION_INVALID');
    const request=eligibilityInput(operation.request);
    need(operation.id===entityId('eo',state,request)&&operation.requestId===request.requestId&&
      operation.requestSha256===eligibilityDigest(request)&&same(operation.request,request)&&
      operation.originalRevision===request.expectedRevision&&operation.action===request.action&&
      same(operation.actor,request.actor),'PORTABLE_ELIGIBILITY_REQUEST_CHANGED');
    need(!seen.has(operation.id)&&!requests.has(operation.requestId),'PORTABLE_ELIGIBILITY_OPERATION_DUPLICATE');
    seen.add(operation.id);requests.add(operation.requestId);
    const {sha256,...payload}=operation;
    need(sha256===eligibilityDigest(payload),'PORTABLE_ELIGIBILITY_OPERATION_CHANGED');
    const result=operation.result,sources=[
      ...array(result.workSet?.sources),...array(result.decision?.basisSources),
      ...array(result.study?.sources),...(result.decision?.source?[result.decision.source]:[]),
      ...(result.resolution?.source?[result.resolution.source]:[])];
    for(const source of sources)validateSourceBinding(source,editions,knownOccurrences);
  }
}
export function validateEligibilityTransition(previous,state,projected){
  const old=previous?.eligibilityEvents??[],current=state.eligibilityEvents??[];
  need(current.length>=old.length&&old.every((value,index)=>same(value,current[index])),
    'PORTABLE_ELIGIBILITY_HISTORY_CHANGED');
  const added=current.slice(old.length);
  need(added.length<=1&&added.every(value=>value.revision===state.revision&&
    value.originalRevision===previous?.revision&&value.originalRevisionSha256===state.previous),
    'PORTABLE_ELIGIBILITY_HISTORY_INVALID');
  if(!added.length)return;
  need(previous&&projected instanceof Map,'PORTABLE_ELIGIBILITY_PREVIOUS_STATE_REQUIRED');
  const replay=clone(previous),operation=added[0];
  recordEligibilityOperation(replay,projected,operation.request,operation.createdAt);
  const content=value=>Object.fromEntries(Object.entries(value).filter(([key])=>
    !['revision','previous','updatedAt','change'].includes(key)));
  need(same(content(replay),content(state)),'PORTABLE_ELIGIBILITY_TRANSITION_CHANGED');
}

const eligibilityHtmlEscape=value=>String(value??'').replace(/[&<>"']/g,char=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const eligibilityMd=value=>String(value??'').replace(/[\\`*_{}\[\]<>#+!|]/g,'\\$&').replace(/\r?\n/g,' ');
function eligibilityMarkdownTable(headers,rows){
  return ['| '+headers.map(eligibilityMd).join(' | ')+' |','| '+headers.map(()=> '---').join(' | ')+' |',
    ...rows.map(row=>'| '+row.map(eligibilityMd).join(' | ')+' |'),''];
}
export function eligibilityMarkdown(report){
  if(!report?.reviews?.length)return [];
  const lines=['## Eligibility review','',
    'Review decisions refer to explicit question-bound retained report occurrences. Work-set and stage counts keep their stated units.',''];
  for(const review of report.reviews){
    lines.push('### '+eligibilityMd(review.name),'','Question: '+eligibilityMd(review.questionText),'',review.description,'');
    for(const protocol of report.protocols.filter(value=>value.reviewId===review.id)){
      lines.push('#### Protocol edition '+protocol.edition+': '+eligibilityMd(protocol.definition.name),'',
        'Question at this edition: '+eligibilityMd(protocol.question.text),'',
        'Recorded by '+eligibilityMd(protocol.actor.name)+' on '+protocol.createdAt+'. '+eligibilityMd(protocol.reason),'',
        ...eligibilityMarkdownTable(['Criterion','Include','Exclude'],protocol.definition.criteria.map(value=>
          [value.name,value.include,value.exclude])),
        ...eligibilityMarkdownTable(['Stage','Criteria','Reviewer IDs','Minimum decisions','Full text required'],
          protocol.definition.stages.map(value=>[value.name,value.criterionIds.join(', '),value.reviewerIds.join(', '),
            value.minimumDecisions,value.requireFullText?'Yes':'No'])),
        ...eligibilityMarkdownTable(['Exclusion reason ID','Meaning'],protocol.definition.exclusionReasons.map(value=>[value.id,value.label])),
        'Reviewers: '+protocol.definition.reviewers.map(value=>eligibilityMd(value.name+' ('+value.id+')')).join('; ')+'.','',
        'Resolver IDs: '+protocol.definition.resolverIds.map(eligibilityMd).join(', ')+'.','',
        'Resolution: '+eligibilityMd(protocol.definition.disagreementProcedure),'');
    }
  }
  lines.push('### Review flow','',...eligibilityMarkdownTable(['Unit','Count'],[
    ['Distinct retained report occurrences',report.overview.reportOccurrenceCount],
    ['Retained editions represented',report.overview.retainedEditionCount],
    ['Explicitly linked study groups',report.overview.confirmedStudyCount],
    ['Reports without a study link',report.overview.ungroupedReportCount],
    ['Recorded decisions including corrections',report.overview.decisionCount],
    ['Unresolved source/protocol/outcome impacts',report.overview.unresolvedImpactCount]]));
  for(const stage of report.overview.stageCounts)lines.push(
    'Work set '+eligibilityMd(stage.workSetId)+' — '+eligibilityMd(stage.stageName)+': '+stage.reports+
    ' report assignments; '+Object.entries(stage.statusCounts).map(([status,count])=>eligibilityMd(status)+': '+count).join('; ')+'.','');
  lines.push('### Report disposition','',...eligibilityMarkdownTable(
    ['Report','Original occurrence','Stage','Review status','Exclusion reason'],
    report.queue.map(value=>[value.title,value.occurrenceId,value.stageName,value.status,value.resolution?.exclusionReasonId??''])));
  for(const decision of report.decisions){
    lines.push('#### '+eligibilityMd(decision.source.title)+' — '+eligibilityMd(decision.actor.name),'',
      eligibilityMd(decision.disposition)+(decision.active?'':' (superseded)')+' · '+decision.createdAt+
      ' · Stage '+eligibilityMd(decision.stageId),'',decision.reason,'',
      ...eligibilityMarkdownTable(['Criterion','Assessment','Note'],decision.criterionAnswers.map(value=>
        [value.criterionId,value.assessment,value.note])),
      'Basis: '+eligibilityMd(decision.basis.availability)+'; '+eligibilityMd(decision.basis.locator)+
      (decision.basis.note?'; '+eligibilityMd(decision.basis.note):''), '',
      'Original source: '+eligibilityMd(decision.source.editionId)+' / '+eligibilityMd(decision.occurrenceId)+
      '; SHA-256 '+decision.source.sourceSha256+'.','');
  }
  for(const resolution of report.resolutions)lines.push(
    '#### Resolution: '+eligibilityMd(resolution.source.title),'',
    eligibilityMd(resolution.mode)+' · '+eligibilityMd(resolution.disposition)+' · '+eligibilityMd(resolution.actor.name)+
    ' · '+resolution.createdAt+(resolution.current?'':' · previous resolution'),'',
    resolution.reason,'','Decision references: '+resolution.decisionIds.map(eligibilityMd).join(', ')+'.','');
  for(const study of report.studies)lines.push('### Study: '+eligibilityMd(study.name),'',study.reason,'',
    ...eligibilityMarkdownTable(['Report occurrence','Source locator','Link rationale'],
      study.evidence.map(value=>[value.occurrenceId,value.locator,value.note])));
  if(report.impact.length)lines.push('### Changes requiring reconsideration','',
    ...eligibilityMarkdownTable(['Change','Status','Occurrences','Latest review'],
      report.impact.map(value=>[value.title,value.status,value.occurrenceIds.join(', '),value.lastReview?.reason??''])));
  for(const application of report.applications)lines.push('### Applied outcomes','',
    eligibilityMd(application.actor.name)+' · '+application.createdAt+' · dossier revision '+application.revision,'',
    application.reason,'',...eligibilityMarkdownTable(['Occurrence','Selected before','Selected after','Classification','Resolution'],
      application.outcomes.map(value=>[value.occurrenceId,value.before?.selected??'No saved selection',
        value.after.selected,value.after.classification,value.resolutionId])));
  return lines;
}
function eligibilityHtmlTable(headers,rows){
  return '<div class="table"><table><thead><tr>'+headers.map(value=>'<th>'+eligibilityHtmlEscape(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+eligibilityHtmlEscape(value)+'</td>').join('')+
    '</tr>').join('')+'</tbody></table></div>';
}
export function eligibilityHtml(report){
  if(!report?.reviews?.length)return '';
  const escape=eligibilityHtmlEscape,table=eligibilityHtmlTable;
  const protocols=report.reviews.map(review=>'<article><h3>'+escape(review.name)+'</h3><p>'+escape(review.questionText)+
    '</p><div class="prose">'+escape(review.description)+'</div>'+
    report.protocols.filter(value=>value.reviewId===review.id).map(protocol=>'<details open><summary>Protocol edition '+
      protocol.edition+': '+escape(protocol.definition.name)+'</summary><p>'+escape(protocol.question.text)+'</p>'+
      '<p>'+escape(protocol.actor.name)+' · '+escape(protocol.createdAt)+' · '+escape(protocol.reason)+'</p>'+
      table(['Criterion','Include','Exclude'],protocol.definition.criteria.map(value=>[value.name,value.include,value.exclude]))+
      table(['Stage','Criteria','Reviewer IDs','Minimum','Full text'],protocol.definition.stages.map(value=>
        [value.name,value.criterionIds.join(', '),value.reviewerIds.join(', '),value.minimumDecisions,value.requireFullText?'Required':'Not required']))+
      table(['Exclusion reason ID','Meaning'],protocol.definition.exclusionReasons.map(value=>[value.id,value.label]))+
      '<p>Reviewers: '+escape(protocol.definition.reviewers.map(value=>value.name+' ('+value.id+')').join('; '))+'</p>'+
      '<p>Resolver IDs: '+escape(protocol.definition.resolverIds.join(', '))+'</p>'+
      '<p>Resolution: '+escape(protocol.definition.disagreementProcedure)+'</p></details>').join('')+'</article>').join('');
  const counts=table(['Unit','Count'],[['Distinct retained report occurrences',report.overview.reportOccurrenceCount],
    ['Retained editions represented',report.overview.retainedEditionCount],['Explicitly linked study groups',report.overview.confirmedStudyCount],
    ['Reports without a study link',report.overview.ungroupedReportCount],['Decisions including corrections',report.overview.decisionCount],
    ['Unresolved impacts',report.overview.unresolvedImpactCount]]);
  const stages=report.overview.stageCounts.map(value=>'<p>Work set '+escape(value.workSetId)+' · '+escape(value.stageName)+
    ' · '+value.reports+' report assignments: '+escape(Object.entries(value.statusCounts).map(([key,count])=>key+' '+count).join('; '))+'</p>').join('');
  const queue=table(['Report','Original occurrence','Stage','Status','Exclusion reason'],report.queue.map(value=>
    [value.title,value.occurrenceId,value.stageName,value.status,value.resolution?.exclusionReasonId??'']));
  const decisions=report.decisions.map(value=>'<details><summary>'+escape(value.source.title)+' · '+escape(value.actor.name)+
    ' · '+escape(value.disposition)+(value.active?'':' · superseded')+'</summary><p>'+escape(value.createdAt)+' · '+escape(value.stageId)+
    '</p><div class="prose">'+escape(value.reason)+'</div>'+
    table(['Criterion','Assessment','Note'],value.criterionAnswers.map(answer=>[answer.criterionId,answer.assessment,answer.note]))+
    '<p>Basis: '+escape(value.basis.availability)+' · '+escape(value.basis.locator)+' · '+escape(value.basis.note)+'</p>'+
    '<p class="file-identity">'+escape(value.source.editionId)+' / '+escape(value.occurrenceId)+' · SHA-256 '+
    escape(value.source.sourceSha256)+'</p></details>').join('');
  const resolutions=report.resolutions.map(value=>'<article><h4>Resolution: '+escape(value.source.title)+'</h4><p>'+
    escape(value.mode)+' · '+escape(value.disposition)+' · '+escape(value.actor.name)+' · '+escape(value.createdAt)+
    (value.current?'':' · previous resolution')+'</p><div class="prose">'+escape(value.reason)+'</div>'+
    '<p class="file-identity">Decisions: '+escape(value.decisionIds.join(', '))+'</p></article>').join('');
  const studies=report.studies.map(value=>'<article><h3>Study: '+escape(value.name)+'</h3><div class="prose">'+escape(value.reason)+'</div>'+
    table(['Report occurrence','Source locator','Link rationale'],value.evidence.map(item=>[item.occurrenceId,item.locator,item.note]))+'</article>').join('');
  const impacts=report.impact.length?'<h3>Changes requiring reconsideration</h3>'+table(['Change','Status','Occurrences','Latest review'],
    report.impact.map(value=>[value.title,value.status,value.occurrenceIds.join(', '),value.lastReview?.reason??''])):'';
  const applications=report.applications.map(value=>'<article><h3>Applied outcomes</h3><p>'+escape(value.actor.name)+
    ' · '+escape(value.createdAt)+' · dossier revision '+value.revision+'</p><div class="prose">'+escape(value.reason)+'</div>'+
    table(['Occurrence','Selected before','Selected after','Classification','Resolution'],value.outcomes.map(item=>
      [item.occurrenceId,item.before?.selected??'No saved selection',item.after.selected,item.after.classification,item.resolutionId]))+'</article>').join('');
  return '<section><h2>Eligibility review</h2><p>Each decision refers to an explicit question-bound retained report occurrence. '+
    'Work-set and stage counts keep their stated units.</p>'+protocols+'<h3>Review flow</h3>'+counts+stages+
    '<h3>Report disposition</h3>'+queue+'<h3>Reviewer decisions</h3>'+decisions+resolutions+studies+impacts+applications+'</section>';
}
