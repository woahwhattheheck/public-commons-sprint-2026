// MIT. Exact request and form contracts for the original Research dossier.
import {digest,jsonBytes,need,object} from '../../node/store.mjs';

export const RISK_OF_BIAS_SCHEMA='sf88-research-risk-of-bias-view/v1';
export const RISK_OF_BIAS_OPERATION_SCHEMA='sf88-research-risk-of-bias-operation/v1';
export const RISK_OF_BIAS_REPORT_SCHEMA='sf88-research-risk-of-bias-report/v1';
export const RISK_OF_BIAS_ACTIONS=Object.freeze(['create-review','revise-protocol','create-assessment',
  'revise-assessment','save-draft','submit-review','adjudicate','review-impact']);
export const RISK_OF_BIAS_SECTIONS=Object.freeze(['overview','reviews','protocols','studies','results',
  'assessments','drafts','submissions','comparisons','adjudications','impact','operations','sources']);
export const RISK_OF_BIAS_DESIGNS=Object.freeze(['randomized-parallel','randomized-cluster',
  'randomized-crossover','nonrandomized-intervention','cohort','case-control','cross-sectional',
  'diagnostic-accuracy','prognostic','systematic-review','other']);
export const ANSWER_STATUSES=Object.freeze(['answered','not_reported','unavailable','not_applicable','unanswered']);
export const BASIS_STATUSES=Object.freeze(['supported','not_reported','unavailable','not_applicable']);
export const clone=value=>structuredClone(value);
export const array=value=>Array.isArray(value)?value:[];
export const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const riskOfBiasDigest=value=>digest(jsonBytes(canonical(value)));
export const same=(left,right)=>riskOfBiasDigest(left)===riskOfBiasDigest(right);
export const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const occurrence=value=>typeof value==='string'&&/^o_[a-f0-9]{64}$/.test(value);
export const text=(value,code,max=20000,empty=false)=>{
  need(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0),code);return value;
};
export const fields=(value,allowed,code)=>{
  need(object(value)&&Object.keys(value).every(key=>allowed.includes(key)),code);return value;
};
export const identifier=(value,code='RISK_OF_BIAS_IDENTIFIER_INVALID')=>{
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value),code);return value;
};
export const ids=(value,code,{empty=false,max=1000,validate=identifier}={})=>{
  need(Array.isArray(value)&&value.length<=max&&(empty||value.length>0)&&new Set(value).size===value.length,code);
  value.forEach(item=>validate(item,code));return [...value];
};
export const occurrenceIds=(value,code,empty=false)=>ids(value,code,{
  empty,validate:item=>need(occurrence(item),code),max:1000});
export const actorInput=value=>{
  fields(value,['id','name'],'RISK_OF_BIAS_ACTOR_INVALID');
  return {id:identifier(value.id,'RISK_OF_BIAS_ACTOR_REQUIRED'),
    name:text(value.name,'RISK_OF_BIAS_ACTOR_NAME_REQUIRED',200)};
};
export const byId=(values,id,code)=>{const value=values.find(item=>item.id===id);need(value,code);return value;};
export const entityId=(prefix,state,request)=>prefix+'_'+riskOfBiasDigest({dossierId:state.id,requestId:request.requestId});
export const latestBy=(values,key)=>{const result=new Map();for(const value of values)result.set(key(value),value);return [...result.values()];};
export const nullableId=(value,code)=>value===null?null:identifier(value,code);
export function safeUrl(value,{empty=false}={}){
  text(value,'RISK_OF_BIAS_SOURCE_URL_INVALID',4000,empty);
  if(empty&&!value)return '';
  let url;try{url=new URL(value);}catch{need(false,'RISK_OF_BIAS_SOURCE_URL_INVALID');}
  need(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password,'RISK_OF_BIAS_SOURCE_URL_INVALID');
  return value;
}
function jsonValue(value,depth=0){
  need(depth<=80,'RISK_OF_BIAS_JSON_DEPTH_EXCEEDED');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){need(Number.isFinite(value),'RISK_OF_BIAS_JSON_REQUIRED');return;}
  need(Array.isArray(value)||object(value),'RISK_OF_BIAS_JSON_REQUIRED');
  if(!Array.isArray(value)){
    const prototype=Object.getPrototypeOf(value);
    need(prototype===Object.prototype||prototype===null,'RISK_OF_BIAS_JSON_REQUIRED');
  }
  for(const item of Object.values(value))jsonValue(item,depth+1);
}
export function riskOfBiasInput(input){
  fields(input,['requestId','expectedRevision','actor','action','reviewId','data'],'RISK_OF_BIAS_FIELDS_INVALID');
  need(typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId),'RISK_OF_BIAS_REQUEST_REQUIRED');
  need(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=1,'EXPECTED_REVISION_REQUIRED');
  need(RISK_OF_BIAS_ACTIONS.includes(input.action),'RISK_OF_BIAS_ACTION_INVALID');
  need(object(input.data),'RISK_OF_BIAS_DATA_REQUIRED');jsonValue(input);
  const value={requestId:input.requestId,expectedRevision:input.expectedRevision,actor:actorInput(input.actor),
    action:input.action,...(input.reviewId!==undefined?{reviewId:identifier(input.reviewId)}:{}),data:clone(input.data)};
  need(input.action==='create-review'||value.reviewId,'RISK_OF_BIAS_REVIEW_REQUIRED');
  need(input.action!=='create-review'||input.reviewId===undefined,'RISK_OF_BIAS_CREATE_REVIEW_ID_INVALID');
  need(jsonBytes(value).length<=16*1024*1024,'RISK_OF_BIAS_REQUEST_TOO_LARGE');
  return value;
}
function rightsInput(value){
  fields(value,['basis','statement','url'],'RISK_OF_BIAS_RIGHTS_INVALID');
  need(['original','license','permission','public_domain','reference_only'].includes(value.basis),'RISK_OF_BIAS_RIGHTS_BASIS_REQUIRED');
  return {basis:value.basis,statement:text(value.statement,'RISK_OF_BIAS_RIGHTS_STATEMENT_REQUIRED',12000),
    url:safeUrl(value.url??'',{empty:true})};
}
function urls(value,required=false){
  need(Array.isArray(value)&&value.length<=30&&new Set(value).size===value.length&&(!required||value.length>0),
    'RISK_OF_BIAS_SOURCE_URLS_REQUIRED');
  return value.map(item=>safeUrl(item));
}
export function riskOfBiasProtocol(input){
  fields(input,['name','description','instrument','form','reviewers','resolverIds','minimumReviewers',
    'disagreementProcedure'],'RISK_OF_BIAS_PROTOCOL_FIELDS_INVALID');
  const value=input.instrument;
  fields(value,['id','title','version','origin','sourceUrls','applicableDesigns','scope','rights'],
    'RISK_OF_BIAS_INSTRUMENT_FIELDS_INVALID');
  need(['published','reviewer_authored'].includes(value.origin),'RISK_OF_BIAS_INSTRUMENT_ORIGIN_REQUIRED');
  need(['study','result'].includes(value.scope),'RISK_OF_BIAS_INSTRUMENT_SCOPE_REQUIRED');
  const instrument={id:identifier(value.id),title:text(value.title,'RISK_OF_BIAS_INSTRUMENT_TITLE_REQUIRED',400),
    version:text(value.version,'RISK_OF_BIAS_INSTRUMENT_VERSION_REQUIRED',200),origin:value.origin,
    sourceUrls:urls(value.sourceUrls,value.origin==='published'),
    applicableDesigns:ids(value.applicableDesigns,'RISK_OF_BIAS_DESIGNS_REQUIRED',{max:RISK_OF_BIAS_DESIGNS.length,
      validate:design=>need(RISK_OF_BIAS_DESIGNS.includes(design),'RISK_OF_BIAS_DESIGN_INVALID')}),
    scope:value.scope,rights:rightsInput(value.rights)};
  const incoming=input.form;
  fields(incoming,['title','version','origin','sourceUrls','rights','domains','judgments','requireDomainJudgments',
    'requireOverall'],'RISK_OF_BIAS_FORM_FIELDS_INVALID');
  need(['reviewer_authored','licensed_reproduction'].includes(incoming.origin),'RISK_OF_BIAS_FORM_ORIGIN_REQUIRED');
  const formRights=rightsInput(incoming.rights);
  need(incoming.origin!=='licensed_reproduction'||['license','permission','public_domain'].includes(formRights.basis),
    'RISK_OF_BIAS_FORM_RIGHTS_REQUIRED');
  need(incoming.origin!=='reviewer_authored'||['original','license','permission','public_domain'].includes(formRights.basis),
    'RISK_OF_BIAS_ORIGINAL_FORM_RIGHTS_REQUIRED');
  need(Array.isArray(incoming.domains)&&incoming.domains.length>=1&&incoming.domains.length<=40,
    'RISK_OF_BIAS_DOMAINS_REQUIRED');
  const domainIds=new Set(),fieldIds=new Set();
  const domains=incoming.domains.map(domain=>{
    fields(domain,['id','title','description','requiresEvidence','fields'],'RISK_OF_BIAS_DOMAIN_FIELDS_INVALID');
    identifier(domain.id);need(!domainIds.has(domain.id),'RISK_OF_BIAS_DOMAIN_DUPLICATE');domainIds.add(domain.id);
    need(typeof domain.requiresEvidence==='boolean','RISK_OF_BIAS_DOMAIN_EVIDENCE_FLAG_REQUIRED');
    need(Array.isArray(domain.fields)&&domain.fields.length>0&&domain.fields.length<=50,'RISK_OF_BIAS_FORM_FIELDS_REQUIRED');
    const defined=domain.fields.map(field=>{
      fields(field,['id','label','type','choices','required','requiresEvidence','help'],'RISK_OF_BIAS_FIELD_INVALID');
      identifier(field.id);need(!fieldIds.has(field.id),'RISK_OF_BIAS_FIELD_DUPLICATE');fieldIds.add(field.id);
      need(['text','choice','multi'].includes(field.type),'RISK_OF_BIAS_FIELD_TYPE_INVALID');
      need(Array.isArray(field.choices)&&field.choices.length<=100,'RISK_OF_BIAS_FIELD_CHOICES_INVALID');
      const choices=field.choices.map(choice=>{
        fields(choice,['id','label'],'RISK_OF_BIAS_CHOICE_INVALID');
        return {id:identifier(choice.id),label:text(choice.label,'RISK_OF_BIAS_CHOICE_LABEL_REQUIRED',600)};
      });
      need(new Set(choices.map(choice=>choice.id)).size===choices.length,'RISK_OF_BIAS_CHOICE_DUPLICATE');
      need(field.type==='text'?choices.length===0:choices.length>0,'RISK_OF_BIAS_FIELD_CHOICES_REQUIRED');
      need(typeof field.required==='boolean'&&typeof field.requiresEvidence==='boolean','RISK_OF_BIAS_FIELD_FLAGS_REQUIRED');
      return {id:field.id,label:text(field.label,'RISK_OF_BIAS_FIELD_LABEL_REQUIRED',2000),type:field.type,choices,
        required:field.required,requiresEvidence:field.requiresEvidence,
        help:text(field.help??'','RISK_OF_BIAS_FIELD_HELP_INVALID',12000,true)};
    });
    return {id:domain.id,title:text(domain.title,'RISK_OF_BIAS_DOMAIN_TITLE_REQUIRED',600),
      description:text(domain.description??'','RISK_OF_BIAS_DOMAIN_DESCRIPTION_INVALID',12000,true),
      requiresEvidence:domain.requiresEvidence,fields:defined};
  });
  need(fieldIds.size<=400,'RISK_OF_BIAS_TOO_MANY_FIELDS');
  need(Array.isArray(incoming.judgments)&&incoming.judgments.length>0&&incoming.judgments.length<=30,
    'RISK_OF_BIAS_JUDGMENTS_REQUIRED');
  const judgments=incoming.judgments.map(judgment=>{
    fields(judgment,['id','label','description'],'RISK_OF_BIAS_JUDGMENT_DEFINITION_INVALID');
    return {id:identifier(judgment.id),label:text(judgment.label,'RISK_OF_BIAS_JUDGMENT_LABEL_REQUIRED',600),
      description:text(judgment.description??'','RISK_OF_BIAS_JUDGMENT_DESCRIPTION_INVALID',12000,true)};
  });
  need(new Set(judgments.map(value=>value.id)).size===judgments.length,'RISK_OF_BIAS_JUDGMENT_DUPLICATE');
  need(typeof incoming.requireDomainJudgments==='boolean'&&typeof incoming.requireOverall==='boolean',
    'RISK_OF_BIAS_FORM_FLAGS_REQUIRED');
  const form={title:text(incoming.title,'RISK_OF_BIAS_FORM_TITLE_REQUIRED',400),
    version:text(incoming.version,'RISK_OF_BIAS_FORM_VERSION_REQUIRED',200),origin:incoming.origin,
    sourceUrls:urls(incoming.sourceUrls,incoming.origin==='licensed_reproduction'),rights:formRights,domains,judgments,
    requireDomainJudgments:incoming.requireDomainJudgments,requireOverall:incoming.requireOverall};
  need(Array.isArray(input.reviewers)&&input.reviewers.length>=2&&input.reviewers.length<=40,'RISK_OF_BIAS_REVIEWERS_REQUIRED');
  const reviewers=input.reviewers.map(actorInput);
  need(new Set(reviewers.map(actor=>actor.id)).size===reviewers.length,'RISK_OF_BIAS_REVIEWER_DUPLICATE');
  const resolverIds=ids(input.resolverIds,'RISK_OF_BIAS_RESOLVERS_REQUIRED',{max:40});
  need(resolverIds.every(id=>reviewers.some(actor=>actor.id===id)),'RISK_OF_BIAS_RESOLVER_NOT_REGISTERED');
  need(Number.isSafeInteger(input.minimumReviewers)&&input.minimumReviewers>=2&&input.minimumReviewers<=reviewers.length,
    'RISK_OF_BIAS_MINIMUM_REVIEWERS_INVALID');
  return {name:text(input.name,'RISK_OF_BIAS_PROTOCOL_NAME_REQUIRED',400),
    description:text(input.description??'','RISK_OF_BIAS_PROTOCOL_DESCRIPTION_INVALID',20000,true),
    instrument,form,reviewers,resolverIds,minimumReviewers:input.minimumReviewers,
    disagreementProcedure:text(input.disagreementProcedure,'RISK_OF_BIAS_DISAGREEMENT_PROCEDURE_REQUIRED',20000)};
}
export function passageInput(value){
  fields(value,['occurrenceId','locator','quote','jsonPointer','note','fileName'],'RISK_OF_BIAS_PASSAGE_FIELDS_INVALID');
  need(occurrence(value.occurrenceId),'RISK_OF_BIAS_PASSAGE_OCCURRENCE_REQUIRED');
  const pointer=text(value.jsonPointer??'','RISK_OF_BIAS_PASSAGE_POINTER_INVALID',4096,true);
  need(pointer===''||pointer.startsWith('/')&&!/~(?:[^01]|$)/.test(pointer),'RISK_OF_BIAS_PASSAGE_POINTER_INVALID');
  return {occurrenceId:value.occurrenceId,...(value.fileName===undefined?{}:{fileName:text(value.fileName,'RISK_OF_BIAS_PASSAGE_FILENAME_INVALID',2048)}),locator:text(value.locator,'RISK_OF_BIAS_PASSAGE_LOCATOR_REQUIRED',4000),
    quote:text(value.quote??'','RISK_OF_BIAS_PASSAGE_QUOTE_INVALID',100000,true),jsonPointer:pointer,
    note:text(value.note??'','RISK_OF_BIAS_PASSAGE_NOTE_INVALID',20000,true)};
}
export function riskOfBiasTarget(value){
  fields(value,['studyId','studyVersion','studySha256','design','designRationale','scope','resultId',
    'resultVersion','resultSha256','occurrenceIds','designBasis'],'RISK_OF_BIAS_TARGET_FIELDS_INVALID');
  need(Number.isSafeInteger(value.studyVersion)&&value.studyVersion>=1&&hash(value.studySha256),
    'RISK_OF_BIAS_STUDY_SELECTOR_REQUIRED');
  need(RISK_OF_BIAS_DESIGNS.includes(value.design),'RISK_OF_BIAS_TARGET_DESIGN_REQUIRED');
  need(['study','result'].includes(value.scope),'RISK_OF_BIAS_TARGET_SCOPE_REQUIRED');
  if(value.scope==='result')need(typeof value.resultId==='string'&&Number.isSafeInteger(value.resultVersion)&&
    value.resultVersion>=1&&hash(value.resultSha256),'RISK_OF_BIAS_RESULT_SELECTOR_REQUIRED');
  else need(value.resultId===null&&value.resultVersion===null&&value.resultSha256===null,'RISK_OF_BIAS_STUDY_RESULT_UNEXPECTED');
  need(Array.isArray(value.designBasis)&&value.designBasis.length<=80,'RISK_OF_BIAS_DESIGN_BASIS_INVALID');
  return {studyId:identifier(value.studyId),studyVersion:value.studyVersion,studySha256:value.studySha256,
    design:value.design,designRationale:text(value.designRationale,'RISK_OF_BIAS_DESIGN_RATIONALE_REQUIRED',20000),
    scope:value.scope,resultId:value.scope==='result'?identifier(value.resultId):null,
    resultVersion:value.resultVersion,resultSha256:value.resultSha256,
    occurrenceIds:occurrenceIds(value.occurrenceIds,'RISK_OF_BIAS_TARGET_SOURCES_REQUIRED'),
    designBasis:value.designBasis.map(passageInput)};
}
export function riskOfBiasContent(data,protocol,{complete=false,bind=value=>value}={}){
  const form=protocol.definition.form,fieldMap=new Map(form.domains.flatMap(domain=>domain.fields.map(field=>[field.id,field])));
  need(Array.isArray(data.answers)&&data.answers.length<=fieldMap.size,'RISK_OF_BIAS_ANSWERS_INVALID');
  need(Array.isArray(data.judgments)&&data.judgments.length<=form.domains.length,'RISK_OF_BIAS_DOMAIN_JUDGMENTS_INVALID');
  const basis=values=>{
    need(Array.isArray(values)&&values.length<=80,'RISK_OF_BIAS_BASIS_INVALID');
    return values.map(value=>bind(passageInput(value)));
  };
  const answers=data.answers.map(answer=>{
    fields(answer,['fieldId','status','value','rationale','basis'],'RISK_OF_BIAS_ANSWER_FIELDS_INVALID');
    const field=fieldMap.get(answer.fieldId);need(field,'RISK_OF_BIAS_ANSWER_FIELD_NOT_FOUND');
    need(ANSWER_STATUSES.includes(answer.status),'RISK_OF_BIAS_ANSWER_STATUS_INVALID');
    let value=null;
    if(answer.status==='answered'){
      if(field.type==='text')value=text(answer.value,'RISK_OF_BIAS_TEXT_ANSWER_REQUIRED',40000,!complete);
      else if(field.type==='choice'){
        need(field.choices.some(choice=>choice.id===answer.value),'RISK_OF_BIAS_CHOICE_ANSWER_INVALID');value=answer.value;
      }else{
        value=ids(answer.value,'RISK_OF_BIAS_MULTI_ANSWER_INVALID',{max:field.choices.length,empty:!complete});
        need(value.every(id=>field.choices.some(choice=>choice.id===id)),'RISK_OF_BIAS_MULTI_CHOICE_INVALID');
        value.sort((a,b)=>field.choices.findIndex(c=>c.id===a)-field.choices.findIndex(c=>c.id===b));
      }
    }else need(answer.value===null,'RISK_OF_BIAS_UNAVAILABLE_VALUE_UNEXPECTED');
    const rationale=text(answer.rationale??'','RISK_OF_BIAS_ANSWER_RATIONALE_INVALID',20000,true),references=basis(answer.basis);
    if(complete){
      if(field.required)need(answer.status!=='unanswered','RISK_OF_BIAS_REQUIRED_ANSWER_UNFINISHED');
      if(answer.status!=='answered'&&answer.status!=='unanswered')need(rationale.trim(),'RISK_OF_BIAS_MISSING_INFORMATION_RATIONALE_REQUIRED');
      if(answer.status==='answered'&&field.requiresEvidence)need(references.length,'RISK_OF_BIAS_ANSWER_EVIDENCE_REQUIRED');
    }
    return {fieldId:field.id,status:answer.status,value,rationale,basis:references};
  });
  need(new Set(answers.map(value=>value.fieldId)).size===answers.length,'RISK_OF_BIAS_ANSWER_DUPLICATE');
  if(complete)need([...fieldMap.values()].filter(field=>field.required).every(field=>
    answers.some(answer=>answer.fieldId===field.id&&answer.status!=='unanswered')),'RISK_OF_BIAS_REQUIRED_ANSWERS_MISSING');
  const judgment=(value,domain=null)=>{
    fields(value,domain?['domainId','judgmentId','basisStatus','rationale','basis']:
      ['judgmentId','basisStatus','rationale','basis'],'RISK_OF_BIAS_JUDGMENT_FIELDS_INVALID');
    need(form.judgments.some(item=>item.id===value.judgmentId),'RISK_OF_BIAS_JUDGMENT_SELECTION_REQUIRED');
    need(BASIS_STATUSES.includes(value.basisStatus),'RISK_OF_BIAS_JUDGMENT_BASIS_STATUS_REQUIRED');
    const rationale=text(value.rationale??'','RISK_OF_BIAS_JUDGMENT_RATIONALE_INVALID',20000,true),references=basis(value.basis);
    if(complete){
      need(rationale.trim(),'RISK_OF_BIAS_JUDGMENT_RATIONALE_REQUIRED');
      if(value.basisStatus==='supported'&&(domain?.requiresEvidence??true))
        need(references.length,'RISK_OF_BIAS_JUDGMENT_EVIDENCE_REQUIRED');
    }
    return {...(domain?{domainId:domain.id}:{}),judgmentId:value.judgmentId,basisStatus:value.basisStatus,rationale,basis:references};
  };
  const judgments=data.judgments.map(value=>{
    const domain=form.domains.find(item=>item.id===value.domainId);need(domain,'RISK_OF_BIAS_JUDGMENT_DOMAIN_NOT_FOUND');
    return judgment(value,domain);
  });
  need(new Set(judgments.map(value=>value.domainId)).size===judgments.length,'RISK_OF_BIAS_JUDGMENT_DOMAIN_DUPLICATE');
  if(complete&&form.requireDomainJudgments)need(judgments.length===form.domains.length,'RISK_OF_BIAS_DOMAIN_JUDGMENTS_MISSING');
  const overall=data.overall===null?null:judgment(data.overall);
  if(complete&&form.requireOverall)need(overall,'RISK_OF_BIAS_OVERALL_JUDGMENT_REQUIRED');
  answers.sort((a,b)=>[...fieldMap.keys()].indexOf(a.fieldId)-[...fieldMap.keys()].indexOf(b.fieldId));
  judgments.sort((a,b)=>form.domains.findIndex(d=>d.id===a.domainId)-form.domains.findIndex(d=>d.id===b.domainId));
  return {answers,judgments,overall};
}
