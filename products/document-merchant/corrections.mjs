// MIT. Selected corrections and unchanged repeats from a complete saved composition.
import {dirname,join} from 'node:path';
import {unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {absolute,ownedDirectory,writeExact,encoded,digest,canonical,plain} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {documentError} from './contracts.mjs';
import {normalizeDocumentComposition,parseDocumentDataset,composeDocumentSources,readDocumentComposition,receiveDocumentComposition} from './composition.mjs';

export const DOCUMENT_CORRECTION_DRAFT_SCHEMA='stellar-forge.document-correction-draft.v1';
export const DOCUMENT_CORRECTION_SCHEMA='stellar-forge.document-correction.v1';
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const copy=value=>structuredClone(value);
function need(value,code,message){if(!value)throw documentError(code,message??code);}
function text(value,max,code){
  need(typeof value==='string'&&value.trim().length>0&&value.length<=max&&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value),code);return value;
}
function original(source){
  need(plain(source)&&HASH.test(source.sha256??'')&&source.id===source.plan?.request?.id&&
    Array.isArray(source.plan.documents)&&Array.isArray(source.plan.files),'DOCUMENT_CORRECTION_ORIGINAL_REQUIRED');
  return normalizeDocumentComposition(source.plan.originalRequest);
}
function selection(source,documentIds){
  need(Array.isArray(documentIds)&&documentIds.length>0&&documentIds.length<=2000&&
    new Set(documentIds).size===documentIds.length&&documentIds.every(id=>typeof id==='string'),
    'DOCUMENT_CORRECTION_SELECTION_REQUIRED','Select one or more original documents.');
  const wanted=new Set(documentIds),items=source.plan.documents.filter(item=>wanted.has(item.id));
  need(items.length===wanted.size,'DOCUMENT_CORRECTION_SELECTION_CHANGED');
  return items;
}
function fields(source,{id,name,mode,reason}){
  need(ID.test(id??'')&&id!==source.id,'DOCUMENT_CORRECTION_NEW_ID_REQUIRED',
    'Use a new document-set ID; the original source and results remain in their saved set.');
  need(['correction','repeat'].includes(mode),'DOCUMENT_CORRECTION_MODE_REQUIRED');
  return {id,name:text(name,200,'DOCUMENT_CORRECTION_NAME_REQUIRED'),mode,
    reason:text(reason,2000,'DOCUMENT_CORRECTION_REASON_REQUIRED')};
}
function sourceFile(source,path){
  const file=source.plan.files.find(item=>item.path===path);
  need(file&&typeof file.content==='string','DOCUMENT_CORRECTION_SOURCE_REQUIRED');return file.content;
}
/** Complete grouped records and original template bodies; no merchant operation or write occurs. */
export function documentCorrectionDraft({source,documentIds,id,name,mode='correction',reason}={}){
  const request=original(source),selected=selection(source,documentIds);
  const details=fields(source,{id,name,mode,reason});
  const parsed=parseDocumentDataset(sourceFile(source,'inputs/dataset.'+request.dataset.format),request.dataset);
  const indexes=[...new Set(selected.map(item=>item.recordIndex))].sort((a,b)=>a-b);
  need(indexes.every(index=>Number.isSafeInteger(index)&&index>=0&&index<parsed.records.length),
    'DOCUMENT_CORRECTION_RECORD_CHANGED');
  const templates={};
  for(const item of request.templates.filter(item=>selected.some(doc=>doc.templateId===item.id)))
    templates[item.id]=sourceFile(source,'inputs/template-'+item.id+'.'+(item.format==='html'?'html':'md'));
  return {schema:DOCUMENT_CORRECTION_DRAFT_SCHEMA,
    parent:{id:source.id,sourceSha256:source.sha256},...details,
    documentIds:selected.map(item=>item.id),records:copy(indexes.map(index=>parsed.records[index])),templates};
}
/** Regenerate only selected record/template pairs, preserving the original provider and task references. */
export function composeDocumentCorrection({source,draft}={}){
  need(plain(draft)&&Object.keys(draft).every(key=>['schema','parent','id','name','mode','reason',
    'documentIds','records','templates'].includes(key))&&draft.schema===DOCUMENT_CORRECTION_DRAFT_SCHEMA,
    'DOCUMENT_CORRECTION_DRAFT_REQUIRED');
  const request=original(source);
  need(plain(draft.parent)&&Object.keys(draft.parent).every(key=>['id','sourceSha256'].includes(key))&&
    draft.parent.id===source.id&&draft.parent.sourceSha256===source.sha256,
    'DOCUMENT_CORRECTION_PARENT_CHANGED','Reopen the exact saved original source before preparing its correction.');
  const selected=selection(source,draft.documentIds),details=fields(source,draft);
  const baseline=documentCorrectionDraft({source,...details,documentIds:draft.documentIds});
  need(Array.isArray(draft.records)&&draft.records.length===baseline.records.length&&draft.records.every(plain)&&
    plain(draft.templates)&&canonical(Object.keys(draft.templates).sort())===canonical(Object.keys(baseline.templates).sort())&&
    Object.values(draft.templates).every(value=>typeof value==='string'),
    'DOCUMENT_CORRECTION_EDITED_SOURCE_REQUIRED','Retain all selected complete records and template bodies.');
  if(details.mode==='repeat')need(canonical(draft.records)===canonical(baseline.records)&&
    canonical(draft.templates)===canonical(baseline.templates),'DOCUMENT_CORRECTION_REPEAT_SOURCE_CHANGED',
    'An unchanged repeat uses the saved records and templates. Select correction to edit them.');
  const used=new Set(selected.map(item=>item.templateId));
  const next={...copy(source.plan.originalRequest),id:details.id,name:details.name,
    dataset:{source:'selected-records.json',format:'json',recordsPointer:''},
    templates:request.templates.filter(item=>used.has(item.id)).map(item=>({...copy(item),
      source:'template-'+item.id+'.'+(item.format==='html'?'html':'md')})),
    correction:{schema:DOCUMENT_CORRECTION_SCHEMA,mode:details.mode,reason:details.reason,
      parent:{id:source.id,sourceSha256:source.sha256},
      documents:selected.map(item=>({id:item.id,recordKey:item.recordKey,templateId:item.templateId,
        taskReference:item.taskReference,sourceSha256:item.sha256}))}};
  need(encoded(draft).length<=32*1048576,'DOCUMENT_CORRECTION_DRAFT_TOO_LARGE');
  const plan=composeDocumentSources({request:next,dataset:JSON.stringify(draft.records,null,2)+'\n',
    templates:copy(draft.templates)});
  // Exactly the original business records must remain represented, including after edited grouping.
  need(plan.counts.selectedRecords===draft.records.length&&plan.counts.excludedRecords===0,
    'DOCUMENT_CORRECTION_RECORD_CHANGED','Keep the selected record keys; use a new document set for a different business task.');
  return plan;
}

/** Save the derived full source through the original composition receiver; original jobs are unchanged. */
export async function stageDocumentCorrection({sourceDirectory,directory,draft,signal}={}){
  directory=absolute(directory);
  const source=await readDocumentComposition(absolute(sourceDirectory),{
    requireFiles:false,expectedSha256:draft?.parent?.sourceSha256,signal});
  const plan=composeDocumentCorrection({source,draft}),raw=encoded(plan);
  const root=dirname(directory);await ownedDirectory(root,{create:true});
  const temporary=join(root,'.document-correction-'+randomUUID()+'.json');
  try{
    signal?.throwIfAborted();await writeExact(temporary,raw);
    return await receiveDocumentComposition({source:temporary,directory,expectedSha256:digest(raw),signal});
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
