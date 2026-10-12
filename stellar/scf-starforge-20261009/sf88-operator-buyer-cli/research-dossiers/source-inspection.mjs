// MIT. Compact inspection and exact downloads from an original retained research edition.
import {basename} from 'node:path';
import {need,object} from '../node/store.mjs';
import {hash,normalizeResponse,canonicalSource,sourceView} from './normalize.mjs';
import {SOURCE_BUNDLE_SCHEMA,sourceBundleFileBytes} from './source-bundles.mjs';

export const SOURCE_INSPECTION_SCHEMA='sf88-research-source-inspection-v1';
export const SOURCE_CONTENT_PREVIEW_BYTES=16384;
const encoded=value=>Buffer.from(JSON.stringify(value),'utf8');
const representation=value=>typeof value==='string'?'text':Array.isArray(value)?'array':'object';
const contentBytes=value=>typeof value==='string'?Buffer.from(value,'utf8'):encoded(value);
const fileMetadata=file=>Object.fromEntries(['name','encoding','bytes','sha256','mediaType']
  .filter(key=>Object.hasOwn(file,key)).map(key=>[key,file[key]]));
const retainedSelection=citation=>citation?Object.fromEntries(
  ['editionId','key','occurrenceId','questionId','retained'].map(key=>[key,citation[key]])):null;

/** A source list keeps descriptive fields and typed small content. Large payloads
 * are represented explicitly and remain downloadable from their original occurrence.
 * The cache lasts only for this response; it never retains source bodies between reads.
 */
export function sourceInspector(){
  const records=new WeakMap(),contents=new WeakMap();
  function record(value){
    if(object(value)&&records.has(value))return records.get(value);
    const bytes=encoded(value),result={representation:'original-record-json',bytes:bytes.length,sha256:hash(bytes)};
    if(object(value))records.set(value,result);
    return result;
  }
  function content(value,bundle=false){
    if(object(value)&&contents.has(value)&&contents.get(value).bundle===bundle)return contents.get(value).result;
    const bytes=contentBytes(value),json=typeof value==='string'?encoded(value):bytes;
    const files=bundle&&object(value)&&Array.isArray(value.files)?value.files.map(fileMetadata):[];
    const result={value:null,descriptor:{representation:representation(value),bytes:bytes.length,
      sha256:hash(bytes),contentDigest:hash(json),complete:false,files}};
    if(files.length){
      result.value={...value,files}; // Keep summary and typed descriptive fields; only original file bodies are removed.
    }else if(json.length<=SOURCE_CONTENT_PREVIEW_BYTES){
      result.value=value;result.descriptor.complete=true;
    }else if(typeof value==='string'){
      result.value=value.slice(0,4096);
    }
    if(object(value))contents.set(value,{bundle,result});
    return result;
  }
  function source(value){
    if(value.inspection?.schema===SOURCE_INSPECTION_SCHEMA)return value;
    const contentDigest=hash(encoded(value.content));
    const selected=[...value.citations].reverse().find(citation=>citation.contentDigest===contentDigest)??value.citations.at(-1);
    const current=content(value.content,selected?.provider==='source-bundle');
    const citations=value.citations.map(citation=>{
      const {original,...fields}=citation;
      return {...fields,originalRecord:original===undefined?null:record(original)};
    });
    const variants=value.variants.map(variant=>{
      const {original,content:originalContent,...fields}=variant;
      const citation=citations.find(row=>row.editionId===variant.editionId&&row.contentDigest===variant.contentDigest);
      const preview=content(originalContent,citation?.provider==='source-bundle');
      return {...fields,content:preview.value,inspection:{schema:SOURCE_INSPECTION_SCHEMA,
        ...preview.descriptor,selection:retainedSelection(citation)},
        originalRecord:original===undefined?null:record(original)};
    });
    return {...value,snippet:typeof value.snippet==='string'?value.snippet.slice(0,4096):value.snippet,
      content:current.value,citations,variants,
      inspection:{schema:SOURCE_INSPECTION_SCHEMA,...current.descriptor,
        snippetComplete:typeof value.snippet!=='string'||value.snippet.length<=4096,selection:retainedSelection(selected)}};
  }
  return {source,record,content};
}
export function inspectResearchSources(values){
  const inspect=sourceInspector();return values.map(value=>inspect.source(value));
}
export function inspectResearchComparison(value){
  const inspect=sourceInspector();
  return {...value,added:value.added.map(row=>inspect.source(row)),removed:value.removed.map(row=>inspect.source(row)),
    changed:value.changed.map(change=>({...change,before:inspect.source(change.before),after:inspect.source(change.after)}))};
}
/** Explicit browser projection. Full original SDK reads and byte exports keep their contract. */
export function inspectResearchResponse(value){
  if(!object(value))return value;
  if(value.schema==='sf88-research-dossier-v1'&&Array.isArray(value.sources))
    return {...value,sources:inspectResearchSources(value.sources),sourceProjection:'inspection'};
  if(object(value.dossier)&&Array.isArray(value.dossier.sources))
    return {...value,dossier:inspectResearchResponse(value.dossier)};
  if(Number.isSafeInteger(value.before)&&Number.isSafeInteger(value.after)&&
    Array.isArray(value.added)&&Array.isArray(value.removed)&&Array.isArray(value.changed))
    return inspectResearchComparison(value);
  return value;
}

async function originalSource(store,id,{editionId,key,revision}={}){
  need(typeof editionId==='string'&&/^e_[a-f0-9]{64}$/.test(editionId),'RETAINED_EDITION_REQUIRED');
  need(typeof key==='string'&&/^(0|[1-9][0-9]{0,8})$/.test(key),'RESEARCH_OCCURRENCE_KEY_INVALID');
  const retained=await store.readRetainedEdition(id,editionId,{revision});
  const normalized=normalizeResponse(retained.bytes,retained.edition.provider);
  const item=normalized.items.find(row=>row.key===key);
  need(item,'RESEARCH_OCCURRENCE_NOT_FOUND');
  const occurrenceId='o_'+hash(editionId+'\n'+key);
  const sourceId='s_'+hash(canonicalSource(item,occurrenceId));
  return {retained,normalized,item,selection:{dossierId:id,revision:retained.revision,
    editionId,key,occurrenceId,sourceId,questionId:retained.edition.questionId}};
}
export async function inspectRetainedSource(store,id,options){
  const {retained,normalized,item,selection}=await originalSource(store,id,options);
  const projected={...normalized,items:[item]};
  const metadata=await store.getMetadata(id,{revision:retained.revision});
  const source=sourceView([retained.edition],new Map([[retained.edition.id,projected]]),metadata.selections)[0];
  return {schema:SOURCE_INSPECTION_SCHEMA,...selection,edition:retained.edition,
    sourceTerms:normalized.sourceTerms,source:sourceInspector().source(source)};
}
/** Content and record are declared serializations of original parsed values.
 * The edition download remains the byte-exact original response. A bundle member
 * is decoded and verified by the original bundle reader, preserving binary and BOM bytes.
 */
export async function readRetainedSourceFile(store,id,{part='content',name,expectedSha256,...options}={}){
  need(['content','record','file'].includes(part),'RESEARCH_SOURCE_PART_INVALID');
  need(expectedSha256===undefined||typeof expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedSha256),
    'RESEARCH_SHA256_REQUIRED');
  const {retained,normalized,item,selection}=await originalSource(store,id,options);
  let bytes,filename,contentType,representation;
  if(part==='file'){
    need(typeof name==='string'&&typeof expectedSha256==='string','RESEARCH_SOURCE_FILE_SELECTION_REQUIRED');
    need(normalized.raw.schema===SOURCE_BUNDLE_SCHEMA,'SOURCE_BUNDLE_REQUIRED');
    const file=item.content?.files?.find(value=>value.name===name);
    need(file,'RESEARCH_SOURCE_FILE_NOT_FOUND');
    need(file.sha256===expectedSha256,'RESEARCH_SOURCE_FILE_CHANGED');
    bytes=sourceBundleFileBytes(file);filename=basename(file.name);
    contentType=typeof file.mediaType==='string'&&/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:; charset=[A-Za-z0-9_-]+)?$/i.test(file.mediaType)
      ?file.mediaType:'application/octet-stream';
    representation='original-file-bytes';
  }else{
    need(name===undefined,'RESEARCH_SOURCE_FILE_SELECTION_INVALID');
    const text=part==='content'&&typeof item.content==='string';
    bytes=part==='content'?contentBytes(item.content):encoded(item.original);
    filename=retained.edition.id+'-'+options.key+'-'+part+(text?'.txt':'.json');
    contentType=text?'text/plain; charset=utf-8':'application/json; charset=utf-8';
    representation=part==='content'?(text?'text':'content-json'):'original-record-json';
  }
  const sha256=hash(bytes);
  need(expectedSha256===undefined||expectedSha256===sha256,'RESEARCH_SOURCE_FILE_CHANGED');
  return {bytes,filename,contentType,sha256,representation,selection:{
    ...selection,...(name===undefined?{}:{name}),part}};
}
