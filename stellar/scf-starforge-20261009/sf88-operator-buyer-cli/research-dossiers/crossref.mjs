// MIT. DOI enrichment joins the original dossier's questions, revisions and retained evidence.
import {jsonBytes,parseJson,digest,need,object} from '../node/store.mjs';
import {buildCrossrefEdition,normalizeDoi,doiList,crossrefFieldChanges,parseCapture} from '../../sf30-seller-sdk/crossref/metadata.mjs';

export const CROSSREF_RECEIVING_CONTRACT='stellar-forge.crossref-dossier.v1';
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function validateCrossrefEdition(value){
  need(object(value)&&value.schema==='sf88-research-results-v1'&&value.provider==='crossref'&&
    value.usage?.schema==='stellar-forge.crossref-edition.v1'&&Array.isArray(value.originalResponses),'CROSSREF_EDITION_REQUIRED');
  const rebuilt=buildCrossrefEdition({captures:value.originalResponses,dois:value.usage.requestedDois,query:value.query,label:value.label});
  need(JSON.stringify(canonical(value))===JSON.stringify(canonical(rebuilt)),'CROSSREF_EDITION_PROJECTION_CHANGED');
  return value;
}
export function selectedCrossrefDois(view,{questionId,selectedOnly=true}={}){
  need(object(view)&&Array.isArray(view.questions)&&Array.isArray(view.sources),'DOSSIER_VIEW_REQUIRED');
  need(view.questions.some(question=>question.id===questionId),'QUESTION_NOT_FOUND');
  const records=view.sources.filter(source=>(!selectedOnly||source.selected)&&source.doi&&
    source.citations?.some(citation=>citation.questionId===questionId));
  const values=[];
  for(const source of records){try{values.push(normalizeDoi(source.doi));}catch{/* Sources without a usable DOI stay in their original dossier. */}}
  need(values.length>0,'CROSSREF_SELECTED_DOIS_REQUIRED');return doiList(values);
}
export async function receiveCrossrefEdition(dossiers,id,{questionId,label='Crossref DOI enrichment',captures,dois,
  expectedRevision,sourceReference='',origin=null}={}){
  need(Number.isSafeInteger(expectedRevision)&&expectedRevision>=0,'EXPECTED_REVISION_REQUIRED');
  const before=await dossiers.get(id);
  need(before.revision===expectedRevision,'REVISION_CONFLICT');
  const question=before.questions.find(question=>question.id===questionId);need(question,'QUESTION_NOT_FOUND');
  const selected=dois?doiList(dois):selectedCrossrefDois(before,{questionId});
  const envelope=buildCrossrefEdition({captures,dois:selected,query:question.text,label});
  const raw=jsonBytes(envelope);need(raw.length<=64*1024*1024,'RESEARCH_RESPONSE_TOO_LARGE');
  const dossier=await dossiers.receive(id,{questionId,label,provider:'crossref',rawBytes:raw,sourceReference,
    expectedRevision,origin});
  return {schema:CROSSREF_RECEIVING_CONTRACT,dossierId:id,questionId,revision:dossier.revision,
    originalRevision:before.revision,duplicate:dossier.revision===before.revision,sourceSha256:digest(raw),
    requestedDois:selected,coverage:envelope.usage.coverage,metadataRecords:envelope.results.length,
    updateCollections:envelope.usage.updates,dossier};
}
export async function receiveCrossrefBuyerResult(dossiers,id,{result,questionId,label='Crossref merchant result',
  expectedRevision,sourceReference='',intentId}={}){
  need(result&&typeof result.bytes==='function','ORIGINAL_BUYER_RESULT_REQUIRED');
  const raw=await result.bytes({limit:64*1024*1024});
  validateCrossrefEdition(parseJson(raw));
  // The original buyer receiver verifies its saved delivery and binds the original intent.
  return dossiers.receiveBuyerResult(id,{result,questionId,label,provider:'crossref',
    expectedRevision,sourceReference,intentId});
}
function crossrefRecord(source){
  const citations=(source?.citations??[]).filter(citation=>citation.provider==='crossref'&&object(citation.original?.metadata?.crossref));
  return citations.at(-1)?.original.metadata.crossref??(object(source?.metadata?.crossref)?source.metadata.crossref:null);
}
export function compareCrossrefMetadata(before,after,{dois}={}){
  const selected=dois?new Set(doiList(dois)):null;
  const records=view=>new Map((view.sources??[]).filter(source=>source.doi).flatMap(source=>{
    let doi;try{doi=normalizeDoi(source.doi);}catch{return [];}
    const record=crossrefRecord(source);return record&&(!selected||selected.has(doi))?[[doi,{sourceId:source.id,record}]]:[];
  }));
  const left=records(before),right=records(after),added=[],removed=[],changed=[];
  for(const [doi,value] of right){
    const old=left.get(doi);
    if(!old)added.push({doi,sourceId:value.sourceId,record:value.record});
    else {const fields=crossrefFieldChanges(old.record,value.record);if(fields.length)changed.push({doi,sourceId:value.sourceId,fields});}
  }
  for(const [doi,value] of left)if(!right.has(doi))removed.push({doi,sourceId:value.sourceId});
  return {schema:'stellar-forge.crossref-metadata-comparison.v1',before:before.revision,after:after.revision,added,removed,changed};
}
/** Original source caching retains progress if a long acquisition meets a revision conflict.
 * Retrying with the current dossier revision reuses these exact captures. */
export async function enrichCrossrefDossier(dossiers,id,{source,questionId,expectedRevision,selectedOnly=true,
  includeUpdates=true,label='Crossref DOI enrichment',maxUpdatePages=1000,signal,onCapture}={}){
  need(source&&typeof source.request==='function','CROSSREF_SOURCE_REQUIRED');
  need(Number.isSafeInteger(maxUpdatePages)&&maxUpdatePages>=1&&maxUpdatePages<=10000,'CROSSREF_UPDATE_PAGE_LIMIT_INVALID');
  const before=await dossiers.get(id);need(before.revision===expectedRevision,'REVISION_CONFLICT');
  const dois=selectedCrossrefDois(before,{questionId,selectedOnly});
  const captures=[],receipts=[],errors=[];
  async function obtain(kind,input){
    try{
      signal?.throwIfAborted();const result=await source.request(kind,input,{signal});
      captures.push(result.capture);const receipt={captureId:result.captureId,status:result.capture.status,
        request:result.capture.request,bodySha256:result.capture.bodySha256,cached:result.cached};
      receipts.push(receipt);await onCapture?.(receipt);
      return parseCapture(result.capture);
    }catch(error){
      if(signal?.aborted)throw error;
      errors.push({kind,input,error:typeof error.code==='string'?error.code:'CROSSREF_SOURCE_UNAVAILABLE'});return null;
    }
  }
  for(const doi of dois)await obtain('work',{doi});
  if(includeUpdates){
    // A repeated cursor can be valid for Crossref's stateful iterator.
    for(const doi of dois){
      let cursor='*';
      for(let page=0;page<maxUpdatePages;page++){
        const result=await obtain('updates',{doi,rows:1000,cursor});
        if(!result?.successful)break;
        if(result.value.message.items.length<1000)break;
        const next=result.value.message['next-cursor'];
        if(typeof next!=='string'||!next)break;cursor=next;
      }
    }
  }
  need(captures.length>0,'CROSSREF_NO_CAPTURE_RETAINED');
  const imported=await receiveCrossrefEdition(dossiers,id,{questionId,label,captures,dois,expectedRevision,
    sourceReference:'https://www.crossref.org/documentation/retrieve-metadata/rest-api/'});
  return {...imported,receipts,errors,comparison:compareCrossrefMetadata(before,imported.dossier,{dois})};
}
