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
  const rebuilt=buildCrossrefEdition({captures:value.originalResponses,dois:value.usage.requestedDois,query:value.query,label:value.label,acquisition:value.usage.acquisition});
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
  expectedRevision,sourceReference='',origin=null,acquisition}={}){
  need(Number.isSafeInteger(expectedRevision)&&expectedRevision>=0,'EXPECTED_REVISION_REQUIRED');
  const before=await dossiers.get(id);
  need(before.revision===expectedRevision,'REVISION_CONFLICT');
  const question=before.questions.find(question=>question.id===questionId);need(question,'QUESTION_NOT_FOUND');
  const selected=dois?doiList(dois):selectedCrossrefDois(before,{questionId});
  const envelope=buildCrossrefEdition({captures,dois:selected,query:question.text,label,acquisition});
  const raw=jsonBytes(envelope);need(raw.length<=64*1024*1024,'RESEARCH_RESPONSE_TOO_LARGE');
  const dossier=await dossiers.receive(id,{questionId,label,provider:'crossref',rawBytes:raw,sourceReference,
    expectedRevision,origin});
  return {schema:CROSSREF_RECEIVING_CONTRACT,dossierId:id,questionId,revision:dossier.revision,
    originalRevision:before.revision,duplicate:dossier.revision===before.revision,sourceSha256:digest(raw),
    requestedDois:selected,coverage:envelope.usage.coverage,metadataRecords:envelope.results.length,
    updateCollections:envelope.usage.updates,acquisition:envelope.usage.acquisition,dossier};
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
/** Acquire one reviewed DOI scope. Capture observers may persist original progress; their failures remain caller failures. */
export async function collectCrossrefEdition({source,dois,query,label='Crossref DOI enrichment',
  includeUpdates=true,maxUpdatePages=1000,refresh=false,signal,onCapture}={}){
  need(source&&typeof source.request==='function','CROSSREF_SOURCE_REQUIRED');
  need(typeof includeUpdates==='boolean'&&typeof refresh==='boolean'&&(onCapture===undefined||typeof onCapture==='function'),'CROSSREF_ENRICH_OPTIONS_INVALID');
  need(Number.isSafeInteger(maxUpdatePages)&&maxUpdatePages>=1&&maxUpdatePages<=10000,'CROSSREF_UPDATE_PAGE_LIMIT_INVALID');
  dois=doiList(dois);
  const captures=[],receipts=[],errors=[];
  const acquisition={schema:'stellar-forge.crossref-acquisition.v1',metadata:true,updates:includeUpdates,failures:errors};
  let requests=0,capacityReached=false;
  function recordFailure(phase,kind,input,code){
    errors.push({phase,code,request:{kind,...input}});
  }
  async function obtain(kind,input){
    if(requests>=2000){
      if(!capacityReached)recordFailure('capacity',kind,input,'CROSSREF_ACQUISITION_REQUEST_LIMIT');
      capacityReached=true;return null;
    }
    requests++;
    let result;
    try{signal?.throwIfAborted();result=await source.request(kind,input,{signal,refresh});}
    catch(error){
      if(signal?.aborted)throw error;
      const code=typeof error.code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)?error.code:'CROSSREF_SOURCE_UNAVAILABLE';
      recordFailure('transport',kind,input,code);return null;
    }
    captures.push(result.capture);
    const receipt={captureId:result.captureId,status:result.capture.status,
      request:result.capture.request,bodySha256:result.capture.bodySha256,cached:result.cached};
    receipts.push(receipt);
    // Progress observers are caller code; their failures are not provider transport failures.
    await onCapture?.(receipt);
    try{return parseCapture(result.capture);}catch{return null;}
  }
  for(const doi of dois){await obtain('work',{doi});if(capacityReached)break;}
  if(includeUpdates&&!capacityReached){
    for(const doi of dois){
      let cursor='*';const seen=new Set();
      for(let page=0;page<maxUpdatePages;page++){
        const input={doi,rows:1000,cursor};seen.add(cursor);
        const result=await obtain('updates',input);
        if(!result?.successful)break;
        if(result.value.message.items.length<1000)break;
        const next=result.value.message['next-cursor'];
        if(typeof next!=='string'||!next){recordFailure('pagination','updates',input,'CROSSREF_NEXT_CURSOR_MISSING');break;}
        if(seen.has(next)){recordFailure('pagination','updates',input,'CROSSREF_CURSOR_NOT_ADVANCING');break;}
        if(page+1===maxUpdatePages){recordFailure('capacity','updates',input,'CROSSREF_UPDATE_PAGE_LIMIT');break;}
        // Current Crossref cursors advance; every following request retains the same DOI filter and rows.
        cursor=next;
      }
      if(capacityReached)break;
    }
  }
  const envelope=buildCrossrefEdition({captures,dois,query,label,acquisition});
  return {envelope,captures,receipts,errors};
}
/** Original source caching retains progress if acquisition meets a revision conflict. */
export async function enrichCrossrefDossier(dossiers,id,{source,questionId,expectedRevision,selectedOnly=true,
  includeUpdates=true,label='Crossref DOI enrichment',maxUpdatePages=1000,refresh=false,signal,onCapture}={}){
  need(typeof selectedOnly==='boolean','CROSSREF_ENRICH_OPTIONS_INVALID');
  const before=await dossiers.get(id);need(before.revision===expectedRevision,'REVISION_CONFLICT');
  const question=before.questions.find(item=>item.id===questionId);need(question,'QUESTION_NOT_FOUND');
  const dois=selectedCrossrefDois(before,{questionId,selectedOnly});
  const collected=await collectCrossrefEdition({source,dois,query:question.text,label,includeUpdates,maxUpdatePages,refresh,signal,onCapture});
  const imported=await receiveCrossrefEdition(dossiers,id,{questionId,label,captures:collected.captures,dois,expectedRevision,
    acquisition:collected.envelope.usage.acquisition,
    sourceReference:'https://www.crossref.org/documentation/retrieve-metadata/rest-api/'});
  return {...imported,receipts:collected.receipts,errors:collected.errors,comparison:compareCrossrefMetadata(before,imported.dossier,{dois})};
}
