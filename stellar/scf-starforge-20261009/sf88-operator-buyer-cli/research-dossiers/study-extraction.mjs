// MIT. Versioned, source-bound extraction in the original Research dossier.
import {digest,jsonBytes,need,object} from '../node/store.mjs';
import {eligibilityDigest,eligibilityModel} from './eligibility-review.mjs';
import {SOURCE_BUNDLE_SCHEMA,sourceBundleFileBytes} from './source-bundles.mjs';
import {RESEARCH_PAGE_LIMIT} from './workspace-contracts.mjs';
import {resolveResearchSourcePointers} from './research-source-values.mjs';

export const EXTRACTION_SCHEMA='sf88-research-study-extraction/v1';
export const EXTRACTION_OPERATION_SCHEMA='sf88-research-study-extraction-operation/v1';
export const EXTRACTION_ACTIONS=Object.freeze(['create-form','revise-form','create-result-set',
  'save-extraction','submit-extraction','resolve-result','review-impact']);
export const EXTRACTION_SECTIONS=Object.freeze(['overview','forms','formEditions','resultSets',
  'extractions','submissions','results','resolutions','impact','operations','occurrences','studies']);
export const EXTRACTION_VALUE_STATUSES=Object.freeze(['reported','derived','not-estimable',
  'not-reported','not-applicable','uncertain']);
export const extractionDigest=eligibilityDigest;
const clone=value=>structuredClone(value);
const array=value=>Array.isArray(value)?value:[];
const same=(a,b)=>extractionDigest(a)===extractionDigest(b);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fields=(value,allowed,code)=>{
  need(object(value)&&Object.keys(value).every(key=>allowed.includes(key)),code);return value;
};
const text=(value,code,max=20000,empty=false)=>{
  need(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0),code);return value;
};
const id=(value,code='EXTRACTION_IDENTIFIER_INVALID')=>{
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(value),code);return value;
};
const ids=(value,code,empty=false)=>{
  need(Array.isArray(value)&&(empty||value.length>0)&&new Set(value).size===value.length,code);
  value.forEach(item=>id(item,code));return [...value];
};
const json=value=>{
  const pending=[{item:value,exit:false}],active=new Set();
  while(pending.length){
    const {item,exit}=pending.pop();
    if(exit){active.delete(item);continue;}
    if(item===null||typeof item==='string'||typeof item==='boolean')continue;
    if(typeof item==='number'){need(Number.isFinite(item),'EXTRACTION_JSON_REQUIRED');continue;}
    need(Array.isArray(item)||object(item)&&(Object.getPrototypeOf(item)===Object.prototype||Object.getPrototypeOf(item)===null),
      'EXTRACTION_JSON_REQUIRED');
    need(!active.has(item),'EXTRACTION_JSON_CYCLE_INVALID');active.add(item);
    pending.push({item,exit:true});
    for(const child of Array.isArray(item)?item:Object.values(item))pending.push({item:child,exit:false});
  }
  let serialized;try{serialized=JSON.stringify(value);}catch{need(false,'EXTRACTION_JSON_REQUIRED');}
  need(serialized!==undefined,'EXTRACTION_JSON_REQUIRED');
  return JSON.parse(serialized);
};
const actorInput=value=>{
  fields(value,['id','name'],'EXTRACTION_ACTOR_INVALID');
  return {id:id(value.id),name:text(value.name,'EXTRACTION_ACTOR_NAME_REQUIRED',200)};
};
const byId=(values,identifier,code)=>{const value=values.find(item=>item.id===identifier);need(value,code);return value;};
const latestBy=(values,key)=>{const found=new Map();for(const value of values)found.set(key(value),value);return [...found.values()];};
const entityId=(prefix,state,request)=>prefix+'_'+extractionDigest({dossierId:state.id,requestId:request.requestId});
const eventContent=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='sha256'));
const stateContent=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['revision','previous','updatedAt','change'].includes(key)));

export function extractionInput(input){
  fields(input,['requestId','expectedRevision','actor','action','data'],'EXTRACTION_FIELDS_INVALID');
  need(typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId),'EXTRACTION_REQUEST_REQUIRED');
  need(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=1,'EXPECTED_REVISION_REQUIRED');
  need(EXTRACTION_ACTIONS.includes(input.action),'EXTRACTION_ACTION_INVALID');
  need(object(input.data),'EXTRACTION_DATA_REQUIRED');
  return json({requestId:input.requestId,expectedRevision:input.expectedRevision,
    actor:actorInput(input.actor),action:input.action,data:input.data});
}

/** The original Decimal reader tags source types; numerical tokens remain strings. */
export function extractionTypedValue(value){
  need(Array.isArray(value)&&value.length===2,'EXTRACTION_TYPED_VALUE_REQUIRED');
  const [tag,payload]=value;
  if(tag==='str')need(typeof payload==='string','EXTRACTION_TYPED_STRING_INVALID');
  else if(tag==='number')need(typeof payload==='string'&&/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?$/.test(payload),
    'EXTRACTION_TYPED_NUMBER_INVALID');
  else if(tag==='bool')need(typeof payload==='boolean','EXTRACTION_TYPED_BOOLEAN_INVALID');
  else if(tag==='NoneType')need(payload===null,'EXTRACTION_TYPED_NULL_INVALID');
  else if(tag==='array'){
    need(Array.isArray(payload),'EXTRACTION_TYPED_ARRAY_INVALID');payload.forEach(extractionTypedValue);
  }else if(tag==='object'){
    need(Array.isArray(payload)&&payload.every(pair=>Array.isArray(pair)&&pair.length===2&&typeof pair[0]==='string')&&
      new Set(payload.map(pair=>pair[0])).size===payload.length,'EXTRACTION_TYPED_OBJECT_INVALID');
    payload.forEach(pair=>extractionTypedValue(pair[1]));
  }else need(false,'EXTRACTION_TYPED_TAG_INVALID');
  return clone(value);
}
export function extractionDefinition(input){
  fields(input,['fields','reviewers','extractorIds','resolverIds','minimumExtractions','disagreementProcedure'],
    'EXTRACTION_DEFINITION_FIELDS_INVALID');
  need(Array.isArray(input.fields)&&input.fields.length>0&&Array.isArray(input.reviewers)&&input.reviewers.length>0,
    'EXTRACTION_DEFINITION_REQUIRED');
  const reviewers=input.reviewers.map(actorInput);
  const definitionFields=input.fields.map(value=>{
    fields(value,['id','label','valueType','required','instructions','choices','unit'],'EXTRACTION_FIELD_INVALID');
    need(['text','decimal','integer','boolean','choice','multi-choice','json'].includes(value.valueType)&&
      typeof value.required==='boolean','EXTRACTION_FIELD_TYPE_INVALID');
    const result={id:id(value.id),label:text(value.label,'EXTRACTION_FIELD_LABEL_REQUIRED',240),
      valueType:value.valueType,required:value.required,
      instructions:text(value.instructions??'','EXTRACTION_FIELD_INSTRUCTIONS_INVALID',20000,true),
      unit:text(value.unit??'','EXTRACTION_FIELD_UNIT_INVALID',1000,true)};
    if(['choice','multi-choice'].includes(value.valueType)){
      need(Array.isArray(value.choices)&&value.choices.length>0,'EXTRACTION_CHOICES_REQUIRED');
      result.choices=value.choices.map(choice=>{
        fields(choice,['id','label'],'EXTRACTION_CHOICE_INVALID');
        return {id:id(choice.id),label:text(choice.label,'EXTRACTION_CHOICE_LABEL_REQUIRED',1000)};
      });
      need(new Set(result.choices.map(choice=>choice.id)).size===result.choices.length,'EXTRACTION_CHOICE_DUPLICATE');
    }else need(value.choices===undefined,'EXTRACTION_UNEXPECTED_CHOICES');
    return result;
  });
  need(new Set(reviewers.map(value=>value.id)).size===reviewers.length&&
    new Set(definitionFields.map(value=>value.id)).size===definitionFields.length,'EXTRACTION_DEFINITION_DUPLICATE_ID');
  const extractorIds=ids(input.extractorIds,'EXTRACTION_EXTRACTORS_REQUIRED');
  const resolverIds=ids(input.resolverIds,'EXTRACTION_RESOLVERS_REQUIRED');
  need([...extractorIds,...resolverIds].every(key=>reviewers.some(value=>value.id===key)),'EXTRACTION_REVIEWER_UNREGISTERED');
  need(Number.isSafeInteger(input.minimumExtractions)&&input.minimumExtractions>=1&&input.minimumExtractions<=extractorIds.length,
    'EXTRACTION_MINIMUM_INVALID');
  return {fields:definitionFields,reviewers,extractorIds,resolverIds,minimumExtractions:input.minimumExtractions,
    disagreementProcedure:text(input.disagreementProcedure,'EXTRACTION_DISAGREEMENT_PROCEDURE_REQUIRED')};
}
function registeredActor(formEdition,actor,role){
  const definition=formEdition.definition,registered=definition.reviewers.find(value=>value.id===actor.id);
  const allowed=role==='extractor'?definition.extractorIds:role==='resolver'?definition.resolverIds:
    [...definition.extractorIds,...definition.resolverIds];
  need(registered&&registered.name===actor.name&&allowed.includes(actor.id),'EXTRACTION_ACTOR_OUTSIDE_PROCESS');
}
function records(state){
  const result={forms:[],formEditions:[],resultSets:[],extractions:[],submissions:[],resolutions:[],
    impactReviews:[],operations:array(state.extractionEvents)};
  for(const operation of result.operations){
    for(const [key,list] of [['form','forms'],['formEdition','formEditions'],['resultSet','resultSets'],
      ['extraction','extractions'],['submission','submissions'],['resolution','resolutions'],['impactReview','impactReviews']])
      if(operation.result[key])result[list].push(operation.result[key]);
  }
  return result;
}
const currentForm=(model,formId)=>model.formEditions.filter(value=>value.formId===formId).at(-1);
function resultSetContext(model,resultSetId){
  const resultSet=byId(model.resultSets,resultSetId,'EXTRACTION_RESULT_SET_NOT_FOUND');
  const formEdition=byId(model.formEditions,resultSet.formEditionId,'EXTRACTION_FORM_EDITION_NOT_FOUND');
  return {resultSet,formEdition};
}
function activeSubmissions(model,resultSetId){
  return latestBy(model.submissions.filter(value=>value.resultSetId===resultSetId),value=>value.actor.id);
}
const answerKey=value=>value.rowId+'\n'+value.fieldId;
const comparedAnswer=value=>value?{status:value.status,value:value.value,context:value.context,derivation:value.derivation??null}:null;
const sourceChoice=value=>array(value?.bases).map(basis=>Object.fromEntries(['occurrenceId','kind','pointer','locator','file']
  .filter(key=>Object.hasOwn(basis,key)).map(key=>[key,basis[key]])));
function rowComparison(model,resultSet,row,formEdition,submitted){
  return formEdition.definition.fields.map(field=>{
    const entries=submitted.map(submission=>{
      const extraction=byId(model.extractions,submission.extractionId,'EXTRACTION_DRAFT_NOT_FOUND');
      return {submissionId:submission.id,extractionId:extraction.id,actor:clone(submission.actor),
        answer:clone(extraction.answers.find(value=>value.rowId===row.id&&value.fieldId===field.id)??null)};
    });
    const present=entries.filter(value=>value.answer),missing=present.length!==entries.length;
    const agreement=entries.length>0&&entries.every(value=>same(comparedAnswer(value.answer),comparedAnswer(entries[0].answer)));
    const sourceAgreement=entries.length>0&&entries.every(value=>same(sourceChoice(value.answer),sourceChoice(entries[0].answer)));
    return {fieldId:field.id,label:field.label,required:field.required,
      status:!present.length?'MISSING':missing?'INCOMPLETE':agreement?'AGREEMENT':'DISAGREEMENT',
      sourceAgreement,entries};
  });
}
function resultDescriptor(state,model,resultSet,row,event){
  const {formEdition}=resultSetContext(model,resultSet.id),submitted=activeSubmissions(model,resultSet.id);
  const comparison=rowComparison(model,resultSet,row,formEdition,submitted);
  const history=model.resolutions.filter(value=>value.resultSetId===resultSet.id&&value.rowId===row.id);
  const resolution=history.at(-1)??null;
  const submittedIds=submitted.map(value=>value.id).sort();
  const resolutionCurrent=resolution&&same([...resolution.submissionIds].sort(),submittedIds);
  const enough=submitted.length>=formEdition.definition.minimumExtractions;
  const disputed=comparison.some(value=>['DISAGREEMENT','INCOMPLETE'].includes(value.status)||
    value.required&&value.status==='MISSING');
  const status=resolutionCurrent?'RESOLVED':resolution?'STALE_RESOLUTION':!submitted.length?'NOT_EXTRACTED':
    !enough?'NEEDS_REVIEW':disputed?'DISAGREEMENT':'READY_FOR_RESOLUTION';
  const resultId='xr_'+extractionDigest({dossierId:state.id,resultSetId:resultSet.id,rowId:row.id});
  const editionId='xre_'+extractionDigest({resultId,eventId:event.id});
  const submissions=submitted.map(submission=>{
    const extraction=byId(model.extractions,submission.extractionId,'EXTRACTION_DRAFT_NOT_FOUND');
    return {id:submission.id,actor:clone(submission.actor),submittedAt:submission.createdAt,extractionId:extraction.id,
      reason:submission.reason,values:Object.fromEntries(extraction.answers.filter(value=>value.rowId===row.id)
        .map(value=>[value.fieldId,clone(value)]))};
  });
  const values=resolutionCurrent?Object.fromEntries(resolution.answers.map(value=>[value.fieldId,clone(value)])):null;
  const record={resultSet:{id:resultSet.id,name:resultSet.name},row:clone(row),
    form:{id:formEdition.formId,edition:formEdition.version,name:formEdition.name,definition:clone(formEdition.definition)},
    study:clone(resultSet.study),submissions,comparison,resolution:clone(resolution),resolutionHistory:clone(history),
    values,status,createdAt:event.createdAt,originalRevision:event.originalRevision,revision:event.revision};
  const bindings=[...row.sources,...submissions.flatMap(value=>Object.values(value.values).flatMap(answer=>answer.bases)),
    ...array(resolution?.answers).flatMap(answer=>answer.bases)];
  const unique=new Map(bindings.map(binding=>[extractionDigest(binding),binding]));
  return {resultId,editionId,questionId:resultSet.questionId,studyId:resultSet.study.id,label:row.label,
    status,current:false,sourceBindings:clone([...unique.values()]),record};
}
/** Historical projections are assembled at their original submission/resolution event.
 * A later form, source or draft does not rewrite an earlier result edition.
 */
function resultEditions(state){
  const model={forms:[],formEditions:[],resultSets:[],extractions:[],submissions:[],resolutions:[]},values=[];
  for(const event of array(state.extractionEvents)){
    for(const [key,list] of [['form','forms'],['formEdition','formEditions'],['resultSet','resultSets'],
      ['extraction','extractions'],['submission','submissions'],['resolution','resolutions']])
      if(event.result[key])model[list].push(event.result[key]);
    const changed=event.result.resultSet??(event.result.submission?model.resultSets.find(value=>value.id===event.result.submission.resultSetId):
      event.result.resolution?model.resultSets.find(value=>value.id===event.result.resolution.resultSetId):null);
    if(!changed)continue;
    for(const row of changed.rows){
      if(event.result.resolution&&event.result.resolution.rowId!==row.id)continue;
      values.push(resultDescriptor(state,model,changed,row,event));
    }
  }
  const latest=new Map();for(const value of values)latest.set(value.resultId,value.editionId);
  return values.map(value=>({...value,current:latest.get(value.resultId)===value.editionId}));
}
function impactRows(state,model,eligibility,results){
  const impacts=[];
  function add(resultSet,kind,previous,current){
    const resultIds=results.filter(value=>value.current&&value.record.resultSet.id===resultSet.id).map(value=>value.resultId);
    const idValue='xi_'+extractionDigest({dossierId:state.id,resultSetId:resultSet.id,kind});
    const fingerprint=extractionDigest({id:idValue,previous,current});
    const review=model.impactReviews.filter(value=>value.impactId===idValue&&value.fingerprint===fingerprint).at(-1)??null;
    impacts.push({id:idValue,resultSetId:resultSet.id,resultIds,questionId:resultSet.questionId,kind,previous:clone(previous),
      current:clone(current),fingerprint,review:clone(review)});
  }
  for(const resultSet of model.resultSets){
    const form=byId(model.formEditions,resultSet.formEditionId,'EXTRACTION_FORM_EDITION_NOT_FOUND');
    const current=currentForm(model,form.formId);
    if(current.id!==form.id)add(resultSet,'form-edition',form.id,current.id);
    const question=state.questions.find(value=>value.id===resultSet.questionId);
    if(question?.text!==form.question.text)add(resultSet,'question-wording',form.question,question?{id:question.id,text:question.text}:null);
    const study=eligibility.studies.find(value=>value.id===resultSet.study.id);
    if(!study||study.version!==resultSet.study.version||!same(study,resultSet.study))
      add(resultSet,'study-report-link',resultSet.study,study??null);
    const beforeIds=new Set(resultSet.editionIds);
    const later=state.editions.filter(value=>value.questionId===resultSet.questionId&&!beforeIds.has(value.id))
      .map(value=>({id:value.id,mode:value.mode,provider:value.provider,label:value.label}));
    if(later.length)add(resultSet,'later-source-editions',resultSet.editionIds,later);
    const replacements=model.resultSets.filter(value=>value.supersedes===resultSet.id).map(value=>value.id);
    if(replacements.length)add(resultSet,'revised-result-set',resultSet.id,replacements);
  }
  return impacts;
}
export function studyExtractionModel(state,projected){
  const model=records(state),eligibility=eligibilityModel(state,projected);
  const results=resultEditions(state),impact=impactRows(state,model,eligibility,results);
  const unresolved=results.filter(value=>value.current&&value.status!=='RESOLVED').map(value=>{
    const form=value.record.form.definition,submitted=value.record.submissions.map(item=>item.actor.id);
    return {resultId:value.resultId,editionId:value.editionId,resultSetId:value.record.resultSet.id,
      questionId:value.questionId,studyId:value.studyId,label:value.label,status:value.status,
      missingReviewerIds:form.extractorIds.filter(identifier=>!submitted.includes(identifier)),
      minimumExtractions:form.minimumExtractions,submittedCount:submitted.length,
      disagreementFieldIds:value.record.comparison.filter(item=>item.status==='DISAGREEMENT').map(item=>item.fieldId),
      missingFieldIds:value.record.comparison.filter(item=>item.required&&['MISSING','INCOMPLETE'].includes(item.status)).map(item=>item.fieldId)};
  });
  return {...model,results,impact,unresolved,occurrences:eligibility.occurrences,studies:eligibility.studies,
    studyHistory:eligibility.studyHistory};
}
export function extractionPublicationContext(state,model){
  return {dossierId:state.id,revision:state.revision,results:clone(model.results),impacts:clone(model.impact),
    unresolved:clone(model.unresolved)};
}
function sourceRows(state,projected){
  const eligibility=eligibilityModel(state,projected),result=new Map();
  for(const source of eligibility.occurrences.values()){
    const projection=projected.get(source.editionId),row=projection?.items?.find(value=>value.key===source.key);
    if(row)result.set(source.occurrenceId,{source,row,projection});
  }
  return result;
}
function selectedSource(index,occurrenceId,questionId,allowed){
  const value=index.get(occurrenceId);
  need(value&&value.source.questionId===questionId&&(!allowed||allowed.includes(occurrenceId)),
    'EXTRACTION_RETAINED_SOURCE_REQUIRED');return value;
}
function originalContent(value,fileName){
  if(fileName!==undefined){
    need(value.projection.raw?.schema===SOURCE_BUNDLE_SCHEMA,'EXTRACTION_SOURCE_BUNDLE_REQUIRED');
    const file=value.row.content?.files?.find(item=>item.name===fileName);
    need(file,'EXTRACTION_SOURCE_MEMBER_NOT_FOUND');
    const bytes=sourceBundleFileBytes(file);
    return {bytes,file:{name:file.name,sha256:file.sha256,bytes:file.bytes,mediaType:file.mediaType??null}};
  }
  need(typeof value.row.content==='string','EXTRACTION_EXACT_SOURCE_TEXT_REQUIRED');
  return {bytes:Buffer.from(value.row.content,'utf8'),file:null};
}
const sourceBytesText=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
function pointerInput(value){
  text(value,'EXTRACTION_JSON_POINTER_REQUIRED',4096,true);
  need(value===''||value.startsWith('/')&&!/~(?![01])/u.test(value),'EXTRACTION_JSON_POINTER_INVALID');return value;
}
function basisInput(input){
  fields(input,['occurrenceId','kind','pointer','locator','quote','fileName'],'EXTRACTION_BASIS_FIELDS_INVALID');
  const result={occurrenceId:id(input.occurrenceId),kind:input.kind};
  if(input.fileName!==undefined)result.fileName=text(input.fileName,'EXTRACTION_FILE_NAME_INVALID',2048);
  if(input.kind==='json-pointer'){
    result.pointer=pointerInput(input.pointer);
    need(input.locator===undefined&&input.quote===undefined,'EXTRACTION_POINTER_FIELDS_INVALID');
  }else{
    need(input.kind==='passage'&&input.pointer===undefined,'EXTRACTION_BASIS_KIND_INVALID');
    result.locator=text(input.locator,'EXTRACTION_LOCATOR_REQUIRED',4000);
    result.quote=text(input.quote??'','EXTRACTION_QUOTE_INVALID',100000,true);
  }
  return result;
}
async function resolvedBases(state,projected,items,questionId,allowed,options){
  const index=sourceRows(state,projected),normalized=items.map(basisInput),groups=new Map(),cache=new Map();
  for(const basis of normalized){
    const selected=selectedSource(index,basis.occurrenceId,questionId,allowed);
    if(basis.kind!=='json-pointer')continue;
    const key=basis.occurrenceId+'\n'+(basis.fileName??'');
    if(!groups.has(key))groups.set(key,{selected,basis,pointers:new Set()});
    groups.get(key).pointers.add(basis.pointer);
  }
  const resolver=options.resolveSourcePointers??resolveResearchSourcePointers;
  for(const [key,group] of groups){
    const original=originalContent(group.selected,group.basis.fileName),sourceSha256=digest(original.bytes);
    const batches=[];let pending=[],characters=0;
    for(const pointer of group.pointers){
      if(pending.length===512||characters+pointer.length>262144){batches.push(pending);pending=[];characters=0;}
      pending.push(pointer);characters+=pointer.length;
    }
    if(pending.length)batches.push(pending);
    const result={sourceSha256,sourceBytes:original.bytes.length,parser:null,values:[]};
    for(const pointers of batches){
      const selected=await resolver({rawText:sourceBytesText(original.bytes),expectedSha256:sourceSha256,
        expectedBytes:original.bytes.length,pointers},
        {python:options.python??'python3',signal:options.signal,...(options.timeoutMs?{timeoutMs:options.timeoutMs}:{})});
      need(selected.sourceSha256===sourceSha256&&selected.sourceBytes===original.bytes.length&&
        Array.isArray(selected.values)&&selected.values.length===pointers.length,'EXTRACTION_SOURCE_RESOLVER_MISMATCH');
      need(selected.values.every((value,index)=>value.pointer===pointers[index]&&typeof value.found==='boolean'),
        'EXTRACTION_SOURCE_RESOLVER_POINTERS_CHANGED');
      need(result.parser===null||same(result.parser,selected.parser),'EXTRACTION_SOURCE_PARSER_CHANGED');
      result.parser=clone(selected.parser);
      for(const value of selected.values)if(value.found)extractionTypedValue(value.typedValue);
      result.values.push(...selected.values);
    }
    cache.set(key,{result,original});
  }
  return normalized.map(basis=>{
    const selected=selectedSource(index,basis.occurrenceId,questionId,allowed);
    const common={...clone(selected.source),kind:basis.kind};
    if(basis.kind==='json-pointer'){
      const {result,original}=cache.get(basis.occurrenceId+'\n'+(basis.fileName??''));
      const value=result.values.find(item=>item.pointer===basis.pointer);
      return {...common,pointer:basis.pointer,...(original.file?{file:original.file}:{}),
        contentSha256:result.sourceSha256,contentBytes:result.sourceBytes,parser:clone(result.parser),
        found:value.found,...(value.found?{typedValue:clone(value.typedValue)}:{})};
    }
    let file;
    if(basis.fileName!==undefined)file=originalContent(selected,basis.fileName).file;
    const quoteMatched=typeof selected.row.content==='string'&&!file&&basis.quote.length>0?
      selected.row.content.includes(basis.quote):null;
    return {...common,locator:basis.locator,quote:basis.quote,...(file?{file}:{}),quoteMatched};
  });
}
export async function extractionSourcePointers(state,projected,{occurrenceId,pointers,fileName}={},options={}){
  need(Array.isArray(pointers)&&pointers.length>0&&new Set(pointers).size===pointers.length,
    'EXTRACTION_SOURCE_POINTERS_REQUIRED');
  const source=sourceRows(state,projected).get(occurrenceId);need(source,'EXTRACTION_RETAINED_SOURCE_REQUIRED');
  const values=await resolvedBases(state,projected,pointers.map(pointer=>({occurrenceId,kind:'json-pointer',pointer,
    ...(fileName===undefined?{}:{fileName})})),source.source.questionId,[occurrenceId],options);
  return {schema:'sf88-research-extraction-source-values/v1',dossierId:state.id,revision:state.revision,
    occurrence:clone(source.source),values};
}
function valueForField(field,answer){
  const value=extractionTypedValue(answer.value),[tag,payload]=value;
  if(['not-estimable','not-reported','not-applicable','uncertain'].includes(answer.status))return value;
  if(field.valueType==='text')need(tag==='str','EXTRACTION_TEXT_REQUIRED');
  else if(field.valueType==='decimal')need(['number','str'].includes(tag)&&
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?$/.test(payload),'EXTRACTION_DECIMAL_REQUIRED');
  else if(field.valueType==='integer')need(['number','str'].includes(tag)&&/^-?(?:0|[1-9][0-9]*)$/.test(payload),
    'EXTRACTION_INTEGER_REQUIRED');
  else if(field.valueType==='boolean')need(tag==='bool','EXTRACTION_BOOLEAN_REQUIRED');
  else if(field.valueType==='choice')need(tag==='str'&&field.choices.some(value=>value.id===payload),'EXTRACTION_CHOICE_REQUIRED');
  else if(field.valueType==='multi-choice')need(tag==='array'&&payload.every(value=>value[0]==='str'&&
    field.choices.some(choice=>choice.id===value[1]))&&new Set(payload.map(value=>value[1])).size===payload.length,
    'EXTRACTION_CHOICES_INVALID');
  return value;
}
async function answersInput(state,projected,resultSet,formEdition,items,options){
  need(Array.isArray(items),'EXTRACTION_ANSWERS_REQUIRED');
  const prepared=items.map(input=>{
    fields(input,['rowId','fieldId','status','value','bases','context','note','derivation'],'EXTRACTION_ANSWER_FIELDS_INVALID');
    const row=byId(resultSet.rows,input.rowId,'EXTRACTION_ROW_NOT_FOUND');
    const field=byId(formEdition.definition.fields,input.fieldId,'EXTRACTION_FIELD_NOT_FOUND');
    need(EXTRACTION_VALUE_STATUSES.includes(input.status),'EXTRACTION_VALUE_STATUS_INVALID');
    need(Array.isArray(input.bases??[])&&object(input.context??{}),'EXTRACTION_ANSWER_CONTEXT_INVALID');
    const answer={rowId:row.id,fieldId:field.id,status:input.status,value:valueForField(field,input),
      bases:array(input.bases).map(basisInput),context:json(input.context??{}),
      note:text(input.note??'','EXTRACTION_ANSWER_NOTE_INVALID',100000,true)};
    if(input.status==='derived'){
      fields(input.derivation,['method','inputFieldIds','expression','reference'],'EXTRACTION_DERIVATION_REQUIRED');
      const inputFieldIds=ids(input.derivation.inputFieldIds,'EXTRACTION_DERIVATION_INPUTS_REQUIRED');
      need(inputFieldIds.every(value=>value!==field.id&&formEdition.definition.fields.some(item=>item.id===value)),
        'EXTRACTION_DERIVATION_FIELD_INVALID');
      answer.derivation={method:text(input.derivation.method,'EXTRACTION_DERIVATION_METHOD_REQUIRED'),
        inputFieldIds,expression:text(input.derivation.expression??'','EXTRACTION_EXPRESSION_INVALID',20000,true),
        reference:text(input.derivation.reference??'','EXTRACTION_DERIVATION_REFERENCE_INVALID',4000,true)};
    }else need(input.derivation===undefined,'EXTRACTION_UNEXPECTED_DERIVATION');
    return answer;
  });
  need(new Set(prepared.map(answerKey)).size===prepared.length,'EXTRACTION_ANSWER_DUPLICATE');
  const flat=prepared.flatMap(value=>value.bases);
  const allowed=[...new Set(resultSet.rows.flatMap(value=>value.sources.map(source=>source.occurrenceId)))];
  const bound=await resolvedBases(state,projected,flat,resultSet.questionId,allowed,options);
  let cursor=0;
  return prepared.map(answer=>{
    const row=resultSet.rows.find(value=>value.id===answer.rowId);
    const bases=bound.slice(cursor,cursor+answer.bases.length);cursor+=answer.bases.length;
    need(bases.every(value=>row.sources.some(source=>source.occurrenceId===value.occurrenceId)),
      'EXTRACTION_BASIS_OUTSIDE_ROW');
    const sourceDifferences=bases.filter(value=>value.kind==='json-pointer'&&value.found&&
      !same(value.typedValue,answer.value)).map(value=>({occurrenceId:value.occurrenceId,pointer:value.pointer,
        ...(value.file?{file:value.file}:{}),reported:clone(value.typedValue),entered:clone(answer.value)}));
    return {...answer,bases,sourceDifferences};
  });
}
function validateCompleteAnswers(resultSet,formEdition,answers,{rowId}={}){
  for(const row of resultSet.rows.filter(value=>rowId===undefined||value.id===rowId)){
    const values=answers.filter(value=>value.rowId===row.id);
    for(const field of formEdition.definition.fields)
      if(field.required)need(values.some(value=>value.fieldId===field.id),'EXTRACTION_REQUIRED_ANSWER_MISSING');
    for(const value of values){
      if(['reported','not-estimable'].includes(value.status)){
        need(value.bases.length>0&&value.bases.some(basis=>basis.kind==='json-pointer'?basis.found:
          basis.locator.length>0&&basis.quoteMatched!==false),'EXTRACTION_REPORTED_SOURCE_REQUIRED');
      }
      if(['not-estimable','not-reported','not-applicable','uncertain'].includes(value.status))
        need(value.note.trim().length>0,'EXTRACTION_VALUE_EXPLANATION_REQUIRED');
      if(value.status==='derived')need(value.derivation.inputFieldIds.every(fieldId=>values.some(item=>item.fieldId===fieldId)),
        'EXTRACTION_DERIVATION_INPUT_MISSING');
    }
  }
}
function commonRecord(state,request,createdAt){
  return {actor:clone(request.actor),createdAt,originalRevision:state.revision,revision:state.revision+1};
}
async function applyExtractionAction(state,projected,model,request,createdAt,options){
  const {data,actor}=request,common=commonRecord(state,request,createdAt);
  if(request.action==='create-form'||request.action==='revise-form'){
    const create=request.action==='create-form';
    fields(data,create?['questionId','name','description','definition','reason']:
      ['formId','previousEditionId','name','description','definition','reason'],'EXTRACTION_FORM_FIELDS_INVALID');
    const old=create?null:byId(model.forms,data.formId,'EXTRACTION_FORM_NOT_FOUND');
    const previous=old?currentForm(model,old.id):null;
    if(previous){
      need(data.previousEditionId===previous.id,'EXTRACTION_FORM_EDITION_CHANGED');
      registeredActor(previous,actor,'author');
    }
    const question=byId(state.questions,old?.questionId??data.questionId,'QUESTION_NOT_FOUND');
    const definition=extractionDefinition(data.definition);
    if(create)registeredActor({definition},actor,'author');
    const form=old??{id:entityId('xf',state,request),questionId:question.id,...common};
    const formEdition={id:entityId('xfe',state,request),formId:form.id,version:(previous?.version??0)+1,
      question:{id:question.id,text:question.text},name:text(data.name,'EXTRACTION_FORM_NAME_REQUIRED',240),
      description:text(data.description??'','EXTRACTION_FORM_DESCRIPTION_INVALID',100000,true),definition,
      reason:text(data.reason,'EXTRACTION_FORM_REASON_REQUIRED'),previous:previous?.id??null,...common};
    return {...(create?{form}:{}),formEdition};
  }
  if(request.action==='create-result-set'){
    fields(data,['formEditionId','studyId','studyVersion','name','description','rows','reason','supersedes'],
      'EXTRACTION_RESULT_SET_FIELDS_INVALID');
    const formEdition=byId(model.formEditions,data.formEditionId,'EXTRACTION_FORM_EDITION_NOT_FOUND');
    need(currentForm(model,formEdition.formId).id===formEdition.id,'EXTRACTION_CURRENT_FORM_REQUIRED');
    registeredActor(formEdition,actor,'author');
    const study=byId(model.studies,data.studyId,'EXTRACTION_STUDY_NOT_FOUND');
    need(study.version===data.studyVersion&&study.questionId===formEdition.question.id,'EXTRACTION_STUDY_VERSION_CHANGED');
    need(Array.isArray(data.rows)&&data.rows.length>0,'EXTRACTION_RESULT_ROWS_REQUIRED');
    const rows=data.rows.map(value=>{
      fields(value,['id','label','context','occurrenceIds'],'EXTRACTION_ROW_FIELDS_INVALID');
      const occurrences=ids(value.occurrenceIds,'EXTRACTION_ROW_SOURCES_REQUIRED');
      need(occurrences.every(identifier=>study.occurrenceIds.includes(identifier)),'EXTRACTION_SOURCE_OUTSIDE_STUDY');
      need(object(value.context??{}),'EXTRACTION_ROW_CONTEXT_INVALID');
      const sources=occurrences.map(identifier=>{
        const source=model.occurrences.get(identifier);
        need(source&&source.questionId===study.questionId,'EXTRACTION_RETAINED_SOURCE_REQUIRED');return clone(source);
      });
      return {id:id(value.id),label:text(value.label,'EXTRACTION_ROW_LABEL_REQUIRED',1000),context:json(value.context??{}),sources};
    });
    need(new Set(rows.map(value=>value.id)).size===rows.length,'EXTRACTION_RESULT_ROW_DUPLICATE');
    let previous=null;
    if(data.supersedes!==undefined){
      previous=byId(model.resultSets,data.supersedes,'EXTRACTION_PREVIOUS_RESULT_SET_NOT_FOUND');
      need(previous.questionId===study.questionId&&previous.study.id===study.id,'EXTRACTION_RESULT_SET_SCOPE_CHANGED');
    }
    return {resultSet:{id:entityId('xs',state,request),formEditionId:formEdition.id,questionId:study.questionId,
      study:clone(study),name:text(data.name,'EXTRACTION_RESULT_SET_NAME_REQUIRED',240),
      description:text(data.description??'','EXTRACTION_RESULT_SET_DESCRIPTION_INVALID',100000,true),
      rows,editionIds:state.editions.filter(value=>value.questionId===study.questionId).map(value=>value.id),
      supersedes:previous?.id??null,reason:text(data.reason,'EXTRACTION_RESULT_SET_REASON_REQUIRED'),...common}};
  }
  if(request.action==='save-extraction'){
    fields(data,['resultSetId','answers','reason','supersedes'],'EXTRACTION_DRAFT_FIELDS_INVALID');
    const {resultSet,formEdition}=resultSetContext(model,data.resultSetId);registeredActor(formEdition,actor,'extractor');
    const previous=model.extractions.filter(value=>value.resultSetId===resultSet.id&&value.actor.id===actor.id).at(-1);
    need((data.supersedes??null)===(previous?.id??null),'EXTRACTION_DRAFT_SUPERSEDES_REQUIRED');
    const answers=await answersInput(state,projected,resultSet,formEdition,data.answers,options);
    return {extraction:{id:entityId('xe',state,request),resultSetId:resultSet.id,formEditionId:formEdition.id,
      version:(previous?.version??0)+1,supersedes:previous?.id??null,answers,
      reason:text(data.reason,'EXTRACTION_DRAFT_REASON_REQUIRED'),...common}};
  }
  if(request.action==='submit-extraction'){
    fields(data,['extractionId','reason'],'EXTRACTION_SUBMISSION_FIELDS_INVALID');
    const extraction=byId(model.extractions,data.extractionId,'EXTRACTION_DRAFT_NOT_FOUND');
    const {resultSet,formEdition}=resultSetContext(model,extraction.resultSetId);
    registeredActor(formEdition,actor,'extractor');need(extraction.actor.id===actor.id,'EXTRACTION_DRAFT_ACTOR_MISMATCH');
    need(model.extractions.filter(value=>value.resultSetId===resultSet.id&&value.actor.id===actor.id).at(-1)?.id===extraction.id,
      'EXTRACTION_LATEST_DRAFT_REQUIRED');
    need(!model.submissions.some(value=>value.extractionId===extraction.id),'EXTRACTION_DRAFT_ALREADY_SUBMITTED');
    validateCompleteAnswers(resultSet,formEdition,extraction.answers);
    const previous=activeSubmissions(model,resultSet.id).find(value=>value.actor.id===actor.id);
    return {submission:{id:entityId('xsub',state,request),resultSetId:resultSet.id,extractionId:extraction.id,
      extractionSha256:extractionDigest(extraction),supersedes:previous?.id??null,
      reason:text(data.reason,'EXTRACTION_SUBMISSION_REASON_REQUIRED'),...common}};
  }
  if(request.action==='resolve-result'){
    fields(data,['resultSetId','rowId','submissionIds','mode','answers','reason','supersedes'],'EXTRACTION_RESOLUTION_FIELDS_INVALID');
    const {resultSet,formEdition}=resultSetContext(model,data.resultSetId);
    registeredActor(formEdition,actor,'resolver');
    const row=byId(resultSet.rows,data.rowId,'EXTRACTION_ROW_NOT_FOUND'),submitted=activeSubmissions(model,resultSet.id);
    const submissionIds=ids(data.submissionIds,'EXTRACTION_RESOLUTION_SUBMISSIONS_REQUIRED');
    need(submitted.length>=formEdition.definition.minimumExtractions&&
      same([...submissionIds].sort(),submitted.map(value=>value.id).sort()),'EXTRACTION_CURRENT_SUBMISSIONS_REQUIRED');
    const previous=model.resolutions.filter(value=>value.resultSetId===resultSet.id&&value.rowId===row.id).at(-1);
    need((data.supersedes??null)===(previous?.id??null),'EXTRACTION_RESOLUTION_SUPERSEDES_REQUIRED');
    need(['consensus','adjudication'].includes(data.mode),'EXTRACTION_RESOLUTION_MODE_INVALID');
    const comparison=rowComparison(model,resultSet,row,formEdition,submitted);
    let answers;
    if(data.mode==='consensus'){
      need(data.answers===undefined,'EXTRACTION_CONSENSUS_ANSWERS_COMPUTED');
      need(comparison.every(value=>value.status==='AGREEMENT'||value.status==='MISSING'&&!value.required),
        'EXTRACTION_CONSENSUS_DISAGREEMENT');
      answers=comparison.filter(value=>value.entries[0]?.answer).map(value=>clone(value.entries[0].answer));
    }else{
      need(Array.isArray(data.answers),'EXTRACTION_ADJUDICATED_ANSWERS_REQUIRED');
      const authored=[],choices=[];
      for(const choice of data.answers){
        fields(choice,['fieldId','submissionId','answer'],'EXTRACTION_RESOLUTION_CHOICE_INVALID');
        byId(formEdition.definition.fields,choice.fieldId,'EXTRACTION_FIELD_NOT_FOUND');
        if(choice.submissionId!==undefined){
          need(choice.answer===undefined&&submissionIds.includes(choice.submissionId),'EXTRACTION_RESOLUTION_SUBMISSION_INVALID');
          const submission=byId(submitted,choice.submissionId,'EXTRACTION_SUBMISSION_NOT_FOUND');
          const extraction=byId(model.extractions,submission.extractionId,'EXTRACTION_DRAFT_NOT_FOUND');
          const answer=extraction.answers.find(value=>value.rowId===row.id&&value.fieldId===choice.fieldId);
          need(answer,'EXTRACTION_RESOLUTION_ANSWER_NOT_FOUND');
          choices.push({...clone(answer),chosenSubmissionId:submission.id});
        }else{
          need(object(choice.answer),'EXTRACTION_RESOLUTION_ANSWER_REQUIRED');
          fields(choice.answer,['status','value','bases','context','note','derivation'],'EXTRACTION_RESOLUTION_ANSWER_FIELDS_INVALID');
          authored.push({...choice.answer,rowId:row.id,fieldId:choice.fieldId});
        }
      }
      const bound=await answersInput(state,projected,resultSet,formEdition,authored,options);
      answers=[...choices,...bound];
      need(new Set(answers.map(value=>value.fieldId)).size===answers.length,'EXTRACTION_RESOLUTION_ANSWER_DUPLICATE');
      const order=new Map(formEdition.definition.fields.map((value,index)=>[value.id,index]));
      answers.sort((a,b)=>order.get(a.fieldId)-order.get(b.fieldId));
    }
    validateCompleteAnswers(resultSet,formEdition,answers,{rowId:row.id});
    return {resolution:{id:entityId('xres',state,request),resultSetId:resultSet.id,rowId:row.id,mode:data.mode,
      submissionIds:[...submissionIds].sort(),submissionSha256:extractionDigest(submitted),comparison,answers,
      supersedes:previous?.id??null,reason:text(data.reason,'EXTRACTION_RESOLUTION_REASON_REQUIRED'),...common}};
  }
  fields(data,['impactId','expectedFingerprint','disposition','reason','resultSetId'],'EXTRACTION_IMPACT_FIELDS_INVALID');
  const impact=model.impact.find(value=>value.id===data.impactId);need(impact,'EXTRACTION_IMPACT_NOT_FOUND');
  need(hash(data.expectedFingerprint)&&data.expectedFingerprint===impact.fingerprint,'EXTRACTION_IMPACT_CHANGED');
  const {formEdition}=resultSetContext(model,impact.resultSetId);registeredActor(formEdition,actor,'author');
  need(['retain','revise','replaced'].includes(data.disposition),'EXTRACTION_IMPACT_DISPOSITION_INVALID');
  let receiving=null;
  if(data.resultSetId!==undefined){
    receiving=byId(model.resultSets,data.resultSetId,'EXTRACTION_RESULT_SET_NOT_FOUND');
    need(receiving.questionId===impact.questionId,'EXTRACTION_IMPACT_SCOPE_CHANGED');
  }
  if(data.disposition==='replaced')need(receiving&&receiving.supersedes===impact.resultSetId,'EXTRACTION_REPLACEMENT_REQUIRED');
  return {impactReview:{id:entityId('xiv',state,request),impactId:impact.id,resultSetId:impact.resultSetId,
    fingerprint:impact.fingerprint,disposition:data.disposition,receivingResultSetId:receiving?.id??null,
    observation:{kind:impact.kind,previous:clone(impact.previous),current:clone(impact.current)},
    reason:text(data.reason,'EXTRACTION_IMPACT_REASON_REQUIRED'),...common}};
}
/** Called only inside the existing optimistic dossier commit. */
export async function recordStudyExtractionOperation(state,projected,input,createdAt,options={}){
  const request=extractionInput(input);
  need(state.revision===request.expectedRevision,'REVISION_CONFLICT');
  need(typeof createdAt==='string'&&Number.isFinite(Date.parse(createdAt)),'EXTRACTION_TIME_INVALID');
  need(!array(state.extractionEvents).some(value=>value.requestId===request.requestId),'EXTRACTION_REQUEST_ALREADY_RECORDED');
  const originalRevisionSha256=digest(jsonBytes(state)),model=studyExtractionModel(state,projected);
  const result=await applyExtractionAction(state,projected,model,request,createdAt,options);
  const operation={schema:EXTRACTION_OPERATION_SCHEMA,id:entityId('xo',state,request),requestId:request.requestId,
    requestSha256:extractionDigest(request),request,action:request.action,actor:clone(request.actor),
    originalRevision:state.revision,revision:state.revision+1,originalRevisionSha256,createdAt,result};
  operation.sha256=extractionDigest(operation);
  state.extractionEvents=[...array(state.extractionEvents),operation];
  return clone(operation);
}
function selectedRows(model,section,{formId,resultSetId}){
  if(section==='forms')return model.forms.filter(value=>formId===undefined||value.id===formId)
    .map(value=>({...clone(value),currentEdition:clone(currentForm(model,value.id))}));
  if(section==='formEditions')return model.formEditions.filter(value=>formId===undefined||value.formId===formId);
  const selectedSets=model.resultSets.filter(value=>(resultSetId===undefined||value.id===resultSetId)&&
    (formId===undefined||model.formEditions.find(edition=>edition.id===value.formEditionId)?.formId===formId));
  const setIds=new Set(selectedSets.map(value=>value.id)),questionIds=new Set(selectedSets.map(value=>value.questionId));
  if(formId!==undefined)questionIds.add(byId(model.forms,formId,'EXTRACTION_FORM_NOT_FOUND').questionId);
  if(section==='resultSets')return selectedSets;
  if(section==='results')return model.results.filter(value=>setIds.has(value.record.resultSet.id));
  if(['extractions','submissions','resolutions','impact'].includes(section))return model[section].filter(value=>setIds.has(value.resultSetId));
  if(section==='occurrences')return [...model.occurrences.values()].filter(value=>!formId&&!resultSetId||questionIds.has(value.questionId));
  if(section==='studies')return model.studies.filter(value=>!formId&&!resultSetId||questionIds.has(value.questionId));
  return model.operations.filter(value=>{
    if(!formId&&!resultSetId)return true;
    const result=value.result;
    return result.form?.id===formId||result.formEdition?.formId===formId||result.resultSet&&setIds.has(result.resultSet.id)||
      ['extraction','submission','resolution','impactReview'].some(key=>result[key]&&setIds.has(result[key].resultSetId));
  });
}
export function extractionOverview(state,model,options={}){
  const resultSets=selectedRows(model,'resultSets',options),setIds=new Set(resultSets.map(value=>value.id));
  const results=model.results.filter(value=>value.current&&setIds.has(value.record.resultSet.id));
  const statuses={};for(const value of results)statuses[value.status]=(statuses[value.status]??0)+1;
  return {schema:EXTRACTION_SCHEMA,dossierId:state.id,revision:state.revision,
    formCount:selectedRows(model,'forms',options).length,resultSetCount:resultSets.length,
    resultCount:results.length,resultEditionCount:model.results.filter(value=>setIds.has(value.record.resultSet.id)).length,
    studyCount:new Set(resultSets.map(value=>value.study.id)).size,
    retainedOccurrenceCount:new Set(resultSets.flatMap(value=>value.rows.flatMap(row=>row.sources.map(source=>source.occurrenceId)))).size,
    draftCount:model.extractions.filter(value=>setIds.has(value.resultSetId)).length,
    submissionCount:model.submissions.filter(value=>setIds.has(value.resultSetId)).length,
    resolutionCount:model.resolutions.filter(value=>setIds.has(value.resultSetId)).length,statuses,
    unresolved:model.unresolved.filter(value=>setIds.has(value.resultSetId)),
    impactCount:model.impact.filter(value=>setIds.has(value.resultSetId)).length,
    unreviewedImpactCount:model.impact.filter(value=>setIds.has(value.resultSetId)&&!value.review).length};
}
export function extractionPage(state,model,{section='overview',offset=0,limit=30,formId,resultSetId}={}){
  need(EXTRACTION_SECTIONS.includes(section),'EXTRACTION_SECTION_INVALID');
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=RESEARCH_PAGE_LIMIT,
    'RESEARCH_PAGE_INVALID');
  if(formId!==undefined)byId(model.forms,formId,'EXTRACTION_FORM_NOT_FOUND');
  if(resultSetId!==undefined)byId(model.resultSets,resultSetId,'EXTRACTION_RESULT_SET_NOT_FOUND');
  const options={formId,resultSetId},overview=extractionOverview(state,model,options);
  if(section==='overview')return {...overview,section,complete:true};
  const values=selectedRows(model,section,options);
  return {schema:EXTRACTION_SCHEMA,dossierId:state.id,revision:state.revision,section,overview,
    offset,limit,total:values.length,items:clone(values.slice(offset,offset+limit)),
    nextOffset:offset+limit<values.length?offset+limit:null,complete:offset===0&&offset+limit>=values.length};
}
/** Full domain export; portable export remains the original dossier engine. */
export function extractionReport(state,model,options={}){
  const result={schema:EXTRACTION_SCHEMA,dossierId:state.id,revision:state.revision,overview:extractionOverview(state,model,options)};
  for(const section of EXTRACTION_SECTIONS.filter(value=>value!=='overview'))result[section]=clone(selectedRows(model,section,options));
  return result;
}
export function validateStudyExtractionState(state){
  need(state.extractionEvents===undefined||Array.isArray(state.extractionEvents),'PORTABLE_EXTRACTION_EVENTS_INVALID');
  const events=array(state.extractionEvents),requests=new Set(),operationIds=new Set();let previousRevision=0;
  for(const operation of events){
    need(object(operation)&&operation.schema===EXTRACTION_OPERATION_SCHEMA&&
      operation.id===entityId('xo',state,operation.request),'PORTABLE_EXTRACTION_OPERATION_INVALID');
    const request=extractionInput(operation.request);
    need(!requests.has(request.requestId)&&!operationIds.has(operation.id),'PORTABLE_EXTRACTION_OPERATION_DUPLICATE');
    requests.add(request.requestId);operationIds.add(operation.id);
    need(same(request,operation.request)&&operation.requestId===request.requestId&&
      operation.requestSha256===extractionDigest(request)&&operation.action===request.action&&
      same(operation.actor,request.actor),'PORTABLE_EXTRACTION_REQUEST_CHANGED');
    need(Number.isSafeInteger(operation.originalRevision)&&operation.originalRevision===request.expectedRevision&&
      operation.revision===operation.originalRevision+1&&operation.revision>previousRevision&&
      operation.revision<=state.revision&&hash(operation.originalRevisionSha256)&&
      typeof operation.createdAt==='string'&&Number.isFinite(Date.parse(operation.createdAt)),
      'PORTABLE_EXTRACTION_REVISION_INVALID');
    previousRevision=operation.revision;
    need(object(operation.result)&&Object.keys(operation.result).length>=1&&
      Object.keys(operation.result).every(key=>['form','formEdition','resultSet','extraction','submission','resolution','impactReview'].includes(key)),
      'PORTABLE_EXTRACTION_RESULT_INVALID');
    need(hash(operation.sha256)&&operation.sha256===extractionDigest(eventContent(operation)),
      'PORTABLE_EXTRACTION_OPERATION_CHANGED');
  }
}
export async function validateStudyExtractionTransition(previous,state,projected,options={}){
  const old=array(previous?.extractionEvents),current=array(state.extractionEvents);
  need(current.length>=old.length&&old.every((value,index)=>same(value,current[index])),
    'PORTABLE_EXTRACTION_HISTORY_CHANGED');
  const added=current.slice(old.length);
  need(added.length<=1&&added.every(value=>value.revision===state.revision&&
    value.originalRevision===previous?.revision&&value.originalRevisionSha256===state.previous),
    'PORTABLE_EXTRACTION_TRANSITION_INVALID');
  if(!added.length)return;
  need(previous&&projected instanceof Map,'PORTABLE_EXTRACTION_PREVIOUS_STATE_REQUIRED');
  const replay=clone(previous),operation=added[0];
  await recordStudyExtractionOperation(replay,projected,operation.request,operation.createdAt,options);
  need(same(stateContent(replay),stateContent(state)),'PORTABLE_EXTRACTION_TRANSITION_CHANGED');
}
