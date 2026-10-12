// MIT. Exact authored publication input beside the original Research dossier.
import {digest,jsonBytes,need,object} from '../node/store.mjs';

export const EXTRACTION_PUBLICATION_SCHEMA='sf88-research-extraction-publication-view/v1';
export const EXTRACTION_PUBLICATION_OPERATION_SCHEMA='sf88-research-extraction-publication-operation/v1';
export const EXTRACTION_PUBLICATION_EDITION_SCHEMA='sf88-research-extraction-publication-edition/v1';
export const EXTRACTION_PUBLICATION_ACTIONS=Object.freeze([
  'create-table','revise-table','publish-table','review-impact','withdraw-publication']);
export const EXTRACTION_PUBLICATION_SECTIONS=Object.freeze([
  'overview','tables','table-editions','results','publications','rows','impact','reviews','withdrawals','operations','comparison']);
export const EXTRACTION_PUBLICATION_FORMATS=Object.freeze(['json','csv','markdown','html']);

const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const publicationDigest=value=>digest(jsonBytes(canonical(value)));
export const publicationSame=(left,right)=>publicationDigest(left)===publicationDigest(right);
export const publicationClone=value=>JSON.parse(jsonBytes(value).toString('utf8'));
export const publicationHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const publicationFields=(value,allowed,code)=>{
  need(object(value)&&Object.keys(value).every(key=>allowed.includes(key)),code);return value;
};
export const publicationText=(value,code,maximum=20000,empty=false)=>{
  need(typeof value==='string'&&value.length<=maximum&&(empty||value.trim().length>0),code);return value;
};
export const publicationId=(value,code='PUBLICATION_IDENTIFIER_INVALID')=>{
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value),code);return value;
};
export const publicationActor=value=>{
  publicationFields(value,['id','name'],'PUBLICATION_ACTOR_INVALID');
  return {id:publicationId(value.id,'PUBLICATION_ACTOR_REQUIRED'),
    name:publicationText(value.name,'PUBLICATION_ACTOR_NAME_REQUIRED',200)};
};
export const publicationEntityId=(prefix,state,request)=>prefix+'_'+publicationDigest({
  dossierId:state.id,requestId:request.requestId});
const fields=publicationFields,text=publicationText,id=publicationId,copy=publicationClone;
const hash=(value,code)=>{need(publicationHash(value),code);return value;};

/** RFC 6901 only. A pointer is resolved against an original result.record. */
export function publicationPointer(value){
  text(value,'PUBLICATION_POINTER_INVALID',2000,true);
  need(value===''||value.startsWith('/'),'PUBLICATION_POINTER_INVALID');
  const parts=value===''?[]:value.slice(1).split('/');
  need(parts.length<=128&&parts.every(part=>!/~(?:[^01]|$)/u.test(part)),'PUBLICATION_POINTER_INVALID');
  return value;
}
export function publicationCell(record,pointer){
  publicationPointer(pointer);let value=record;
  for(const encoded of pointer===''?[]:pointer.slice(1).split('/')){
    const key=encoded.replace(/~1/g,'/').replace(/~0/g,'~');
    if(Array.isArray(value)){
      if(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length)return {present:false,value:null};
    }else if(!object(value))return {present:false,value:null};
    if(!Object.hasOwn(value,key))return {present:false,value:null};
    value=value[key];
  }
  return {present:true,value:copy(value)};
}
export function publicationDefinition(input){
  fields(input,['name','description','questionIds','columns','notes'],'PUBLICATION_TABLE_FIELDS_INVALID');
  const questionIds=input.questionIds??[];
  need(Array.isArray(questionIds)&&new Set(questionIds).size===questionIds.length,'PUBLICATION_QUESTIONS_INVALID');
  questionIds.forEach(value=>id(value,'PUBLICATION_QUESTION_INVALID'));
  need(Array.isArray(input.columns)&&input.columns.length>=1&&input.columns.length<=100,'PUBLICATION_COLUMNS_REQUIRED');
  const columns=input.columns.map(column=>{
    fields(column,['id','label','pointer','format','description'],'PUBLICATION_COLUMN_FIELDS_INVALID');
    const format=column.format??'text';
    need(['text','typed','json'].includes(format),'PUBLICATION_COLUMN_FORMAT_INVALID');
    return {id:id(column.id,'PUBLICATION_COLUMN_ID_REQUIRED'),label:text(column.label,'PUBLICATION_COLUMN_LABEL_REQUIRED',240),
      pointer:publicationPointer(column.pointer),format,
      description:text(column.description??'','PUBLICATION_COLUMN_DESCRIPTION_INVALID',5000,true)};
  });
  need(new Set(columns.map(column=>column.id)).size===columns.length,'PUBLICATION_COLUMN_DUPLICATE');
  return {name:text(input.name,'PUBLICATION_TABLE_NAME_REQUIRED',240),
    description:text(input.description??'','PUBLICATION_TABLE_DESCRIPTION_INVALID',20000,true),
    questionIds:[...questionIds],columns,notes:text(input.notes??'','PUBLICATION_TABLE_NOTES_INVALID',20000,true)};
}
function resultSelection(value){
  fields(value,['resultId','editionId','fingerprint'],'PUBLICATION_RESULT_SELECTION_INVALID');
  need(typeof value.resultId==='string'&&/^xr_[a-f0-9]{64}$/.test(value.resultId),'PUBLICATION_RESULT_ID_INVALID');
  need(typeof value.editionId==='string'&&/^xre_[a-f0-9]{64}$/.test(value.editionId),'PUBLICATION_RESULT_EDITION_INVALID');
  return {resultId:value.resultId,editionId:value.editionId,
    fingerprint:hash(value.fingerprint,'PUBLICATION_RESULT_FINGERPRINT_INVALID')};
}
export function publicationInput(input){
  // The original transports are JSON. Reject unrepresentable values before normalization.
  const raw=copy(input);
  fields(raw,['requestId','expectedRevision','actor','action','data'],'PUBLICATION_FIELDS_INVALID');
  need(typeof raw.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(raw.requestId),'PUBLICATION_REQUEST_REQUIRED');
  need(Number.isSafeInteger(raw.expectedRevision)&&raw.expectedRevision>=1,'EXPECTED_REVISION_REQUIRED');
  need(EXTRACTION_PUBLICATION_ACTIONS.includes(raw.action),'PUBLICATION_ACTION_INVALID');
  need(object(raw.data),'PUBLICATION_DATA_REQUIRED');
  const value={requestId:raw.requestId,expectedRevision:raw.expectedRevision,actor:publicationActor(raw.actor),
    action:raw.action,data:null},data=raw.data;
  if(raw.action==='create-table'){
    fields(data,['definition'],'PUBLICATION_CREATE_FIELDS_INVALID');
    value.data={definition:publicationDefinition(data.definition)};
  }else if(raw.action==='revise-table'){
    fields(data,['tableId','expectedTableEditionId','definition','reason'],'PUBLICATION_REVISE_FIELDS_INVALID');
    value.data={tableId:id(data.tableId),expectedTableEditionId:id(data.expectedTableEditionId),
      definition:publicationDefinition(data.definition),reason:text(data.reason,'PUBLICATION_REVISION_REASON_REQUIRED')};
  }else if(raw.action==='publish-table'){
    fields(data,['tableId','tableEditionId','previousPublicationId','rows','title','summary','limitations','reason','review'],
      'PUBLICATION_PUBLISH_FIELDS_INVALID');
    need(data.previousPublicationId===null||typeof data.previousPublicationId==='string','PUBLICATION_PREVIOUS_REQUIRED');
    need(Array.isArray(data.rows)&&data.rows.length>=1&&data.rows.length<=10000,'PUBLICATION_ROWS_REQUIRED');
    const rows=data.rows.map(resultSelection);
    // One authored evidence row per logical result; compare different editions through publications.
    need(new Set(rows.map(row=>row.resultId)).size===rows.length,'PUBLICATION_DUPLICATE_RESULT');
    fields(data.review,['contextFingerprint','note'],'PUBLICATION_REVIEW_FIELDS_INVALID');
    value.data={tableId:id(data.tableId),tableEditionId:id(data.tableEditionId),
      previousPublicationId:data.previousPublicationId===null?null:id(data.previousPublicationId),rows,
      title:text(data.title,'PUBLICATION_TITLE_REQUIRED',500),
      summary:text(data.summary??'','PUBLICATION_SUMMARY_INVALID',40000,true),
      limitations:text(data.limitations??'','PUBLICATION_LIMITATIONS_INVALID',40000,true),
      reason:text(data.reason,'PUBLICATION_REASON_REQUIRED'),
      review:{contextFingerprint:hash(data.review.contextFingerprint,'PUBLICATION_REVIEW_FINGERPRINT_REQUIRED'),
        note:text(data.review.note,'PUBLICATION_REVIEW_NOTE_REQUIRED',40000)}};
  }else if(raw.action==='review-impact'){
    fields(data,['publicationId','impactId','fingerprint','disposition','reason'],'PUBLICATION_IMPACT_FIELDS_INVALID');
    need(['reviewed','needs_review','not_applicable'].includes(data.disposition),'PUBLICATION_REVIEW_DISPOSITION_INVALID');
    value.data={publicationId:id(data.publicationId),impactId:id(data.impactId),
      fingerprint:hash(data.fingerprint,'PUBLICATION_IMPACT_FINGERPRINT_REQUIRED'),disposition:data.disposition,
      reason:text(data.reason,'PUBLICATION_IMPACT_REASON_REQUIRED')};
  }else{
    fields(data,['publicationId','expectedPublicationSha256','reason'],'PUBLICATION_WITHDRAW_FIELDS_INVALID');
    value.data={publicationId:id(data.publicationId),
      expectedPublicationSha256:hash(data.expectedPublicationSha256,'PUBLICATION_EDITION_SHA_REQUIRED'),
      reason:text(data.reason,'PUBLICATION_WITHDRAW_REASON_REQUIRED')};
  }
  return value;
}

/** The only excluded field is the current-selection flag. Every original record field is hashed. */
export function publicationResultDescriptor(result){
  need(object(result)&&typeof result.current==='boolean','PUBLICATION_CORE_RESULT_INVALID');
  return copy(Object.fromEntries(Object.entries(result).filter(([key])=>key!=='current')));
}
export function publicationResultFingerprint(result){
  return publicationDigest(publicationResultDescriptor(result));
}
