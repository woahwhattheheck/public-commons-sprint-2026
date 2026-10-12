// MIT. Original files, their source definitions and authored findings travel together.
import {lstat,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep,extname,basename} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {need,object,parseJson,jsonBytes,digest,readBytes} from '../node/store.mjs';

export const SOURCE_BUNDLE_SCHEMA='sf88-research-source-bundle-v1';
export const SOURCE_MANIFEST_SCHEMA='sf88-research-source-manifest-v1';
export const SOURCE_BUNDLE_LIMIT=64*1024*1024;
export const SOURCE_FILE_BYTES_LIMIT=48*1024*1024;
export const SOURCE_MANIFEST_LIMIT=1024*1024;
const text=(value,code,max,empty=false)=>{
  need(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0),code);
  return value;
};
const key=value=>text(value,'SOURCE_BUNDLE_KEY_INVALID',240);
const name=value=>{
  text(value,'SOURCE_BUNDLE_FILENAME_INVALID',1024);
  need(!value.startsWith('/')&&!/^[A-Za-z]:/.test(value)&&!/[\\\u0000-\u001f\u007f]/.test(value)&&
    value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'SOURCE_BUNDLE_FILENAME_INVALID');
  return value;
};
function manifestValue(value){
  need(object(value)&&value.schema===SOURCE_MANIFEST_SCHEMA,'SOURCE_MANIFEST_REQUIRED');
  need(Buffer.byteLength(JSON.stringify(value),'utf8')<=SOURCE_MANIFEST_LIMIT,'SOURCE_MANIFEST_TOO_LARGE');
  text(value.label,'SOURCE_BUNDLE_LABEL_REQUIRED',240);
  text(value.sourceTerms,'SOURCE_BUNDLE_TERMS_REQUIRED',20000);
  if(value.sourceReference!==undefined)text(value.sourceReference,'SOURCE_REFERENCE_INVALID',4000,true);
  if(value.description!==undefined)text(value.description,'SOURCE_BUNDLE_DESCRIPTION_INVALID',20000,true);
  need(Array.isArray(value.sources)&&value.sources.length>0&&value.sources.length<=2048,'SOURCE_BUNDLE_SOURCES_REQUIRED');
  const keys=new Set(),files=new Set();
  for(const source of value.sources){
    need(object(source),'SOURCE_BUNDLE_SOURCE_INVALID');
    key(source.key);need(!keys.has(source.key),'SOURCE_BUNDLE_SOURCE_KEY_DUPLICATE');keys.add(source.key);
    text(source.title,'SOURCE_BUNDLE_SOURCE_TITLE_REQUIRED',240);
    if(source.url!==undefined)text(source.url,'SOURCE_BUNDLE_URL_INVALID',4000,true);
    if(source.doi!==undefined)text(source.doi,'SOURCE_BUNDLE_DOI_INVALID',1000,true);
    if(source.summary!==undefined)text(source.summary,'SOURCE_BUNDLE_SUMMARY_INVALID',100000,true);
    if(source.note!==undefined)text(source.note,'SOURCE_BUNDLE_NOTE_INVALID',100000,true);
    need(source.selected===undefined||typeof source.selected==='boolean','SOURCE_BUNDLE_SELECTION_INVALID');
    need(source.classification===undefined||['supports','contradicts','background','unreviewed'].includes(source.classification),
      'CLASSIFICATION_INVALID');
    need(source.authors===undefined||Array.isArray(source.authors),'SOURCE_BUNDLE_AUTHORS_INVALID');
    need(source.metadata===undefined||object(source.metadata),'SOURCE_BUNDLE_METADATA_INVALID');
    need(Array.isArray(source.files)&&source.files.length>0&&new Set(source.files).size===source.files.length,
      'SOURCE_BUNDLE_SOURCE_FILES_REQUIRED');
    for(const file of source.files)files.add(name(file));
  }
  need(files.size<=2048,'SOURCE_BUNDLE_FILE_COUNT_INVALID');
  need(value.findings===undefined||Array.isArray(value.findings)&&value.findings.length<=1000,'SOURCE_BUNDLE_FINDINGS_INVALID');
  const findingKeys=new Set();
  for(const finding of value.findings??[]){
    need(object(finding),'SOURCE_BUNDLE_FINDING_INVALID');
    key(finding.key);need(!findingKeys.has(finding.key),'SOURCE_BUNDLE_FINDING_KEY_DUPLICATE');findingKeys.add(finding.key);
    text(finding.title,'FINDING_TITLE_REQUIRED',240);text(finding.text,'FINDING_TEXT_REQUIRED',100000);
    need(Array.isArray(finding.sourceKeys)&&finding.sourceKeys.length>0&&
      new Set(finding.sourceKeys).size===finding.sourceKeys.length&&
      finding.sourceKeys.every(value=>keys.has(value)),'SOURCE_BUNDLE_FINDING_SOURCES_INVALID');
  }
  return {manifest:value,files};
}
export function sourceBundleFileBytes(file){
  need(object(file),'SOURCE_BUNDLE_FILE_INVALID');
  name(file.name);
  need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=SOURCE_FILE_BYTES_LIMIT,
    'SOURCE_BUNDLE_FILE_SIZE_INVALID');
  need(typeof file.sha256==='string'&&/^[a-f0-9]{64}$/.test(file.sha256),'SOURCE_BUNDLE_FILE_DIGEST_REQUIRED');
  need(['base64','utf8'].includes(file.encoding)&&typeof file.content==='string','SOURCE_BUNDLE_FILE_ENCODING_INVALID');
  if(file.mediaType!==undefined)text(file.mediaType,'SOURCE_BUNDLE_MEDIA_TYPE_INVALID',240);
  const bytes=Buffer.from(file.content,file.encoding==='utf8'?'utf8':'base64');
  need(file.encoding==='base64'?bytes.toString('base64')===file.content:
    new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)===file.content,
    'SOURCE_BUNDLE_FILE_ENCODING_INVALID');
  need(bytes.length===file.bytes&&digest(bytes)===file.sha256,'SOURCE_BUNDLE_FILE_CHANGED');
  return bytes;
}
export function projectSourceBundle(value){
  need(object(value)&&value.schema===SOURCE_BUNDLE_SCHEMA,'SOURCE_BUNDLE_REQUIRED');
  const {manifest,files:declared}=manifestValue(value.manifest);
  need(Array.isArray(value.files)&&value.files.length===declared.size,'SOURCE_BUNDLE_FILES_INCOMPLETE');
  const files=new Map();let total=0;
  for(const file of value.files){
    const bytes=sourceBundleFileBytes(file);total+=bytes.length;
    need(total<=SOURCE_FILE_BYTES_LIMIT,'SOURCE_BUNDLE_FILES_TOO_LARGE');
    need(declared.has(file.name)&&!files.has(file.name),'SOURCE_BUNDLE_FILE_UNEXPECTED_OR_DUPLICATE');
    files.set(file.name,file);
  }
  need([...declared].every(file=>files.has(file)),'SOURCE_BUNDLE_FILES_INCOMPLETE');
  if(value.manifestOriginal!==undefined){
    const bytes=sourceBundleFileBytes(value.manifestOriginal);
    need(bytes.length<=SOURCE_MANIFEST_LIMIT&&isDeepStrictEqual(parseJson(bytes),manifest),'SOURCE_MANIFEST_ORIGINAL_CHANGED');
  }
  const provider='source-bundle';
  const results=manifest.sources.map(source=>{
    const members=source.files.map(file=>files.get(file));
    return {id:'source-bundle:'+digest(jsonBytes({key:source.key,files:members.map(file=>({name:file.name,sha256:file.sha256}))})),
      title:source.title,description:source.summary||source.files.join('\n'),url:source.url??'',doi:source.doi??'',authors:source.authors??[],
      citation:source.citation??null,references:source.references??null,publishedAt:source.publishedAt??'',
      content:{summary:source.summary??'',files:members},
      metadata:{...(source.metadata??{}),sourceBundleKey:source.key,
        sourceTerms:source.sourceTerms??manifest.sourceTerms,fileCount:members.length,
        fileBytes:members.reduce((sum,file)=>sum+file.bytes,0)},
    };
  });
  return {schema:'sf88-research-results-v1',provider,query:manifest.description??manifest.label,
    sourceTerms:manifest.sourceTerms,results,usage:{files:files.size,fileBytes:total},warnings:[]};
}
export function inspectSourceBundle(input){
  const rawBytes=typeof input==='string'?Buffer.from(input,'utf8'):
    input instanceof Uint8Array?Buffer.from(input):jsonBytes(input);
  need(rawBytes.length>0&&rawBytes.length<=SOURCE_BUNDLE_LIMIT,'SOURCE_BUNDLE_SIZE_INVALID');
  const value=parseJson(rawBytes),projection=projectSourceBundle(value),manifest=value.manifest;
  const preview={schema:'sf88-research-source-bundle-preview-v1',
    bundleSha256:digest(rawBytes),bundleBytes:rawBytes.length,label:manifest.label,
    sourceTerms:manifest.sourceTerms,fileCount:value.files.length,fileBytes:projection.usage.fileBytes,
    sources:manifest.sources.map(source=>({key:source.key,title:source.title,url:source.url??'',doi:source.doi??'',
      fileCount:source.files.length,selected:source.selected??true,
      classification:source.classification??'supports',note:source.note??''})),
    findings:(manifest.findings??[]).map(row=>({key:row.key,title:row.title,text:row.text,sourceKeys:[...row.sourceKeys]}))};
  return {rawBytes,value,manifest,projection,preview};
}
const TYPES={'.csv':'text/csv','.tsv':'text/tab-separated-values','.tab':'text/tab-separated-values',
  '.txt':'text/plain','.md':'text/markdown','.json':'application/json','.html':'text/html',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.pdf':'application/pdf'};
function originalFile(filename,bytes){
  need(bytes instanceof Uint8Array,'SOURCE_BUNDLE_FILE_BYTES_REQUIRED');
  const raw=Buffer.from(bytes);
  return {name:name(filename),bytes:raw.length,sha256:digest(raw),encoding:'base64',
    mediaType:TYPES[extname(filename).toLowerCase()]??'application/octet-stream',content:raw.toString('base64')};
}
export function createSourceBundle({manifestBytes,files,manifestName='source-manifest.json'}){
  need(manifestBytes instanceof Uint8Array&&manifestBytes.length<=SOURCE_MANIFEST_LIMIT,'SOURCE_MANIFEST_BYTES_REQUIRED');
  const {manifest,files:declared}=manifestValue(parseJson(manifestBytes));
  need(files instanceof Map&&files.size===declared.size&&[...declared].every(file=>files.has(file)),
    'SOURCE_BUNDLE_FILES_INCOMPLETE');
  const value={schema:SOURCE_BUNDLE_SCHEMA,manifest,
    manifestOriginal:originalFile(manifestName,manifestBytes),
    files:[...declared].map(file=>originalFile(file,files.get(file)))};
  const bytes=jsonBytes(value);
  return {bytes,preview:inspectSourceBundle(bytes).preview};
}
export async function createSourceBundleFromDirectory({manifestFile,directory}){
  need(typeof manifestFile==='string'&&typeof directory==='string','SOURCE_BUNDLE_DIRECTORY_REQUIRED');
  const manifestBytes=await readBytes(resolve(manifestFile),SOURCE_MANIFEST_LIMIT);
  const {files:declared}=manifestValue(parseJson(manifestBytes));
  const root=await realpath(resolve(directory)),rootStat=await lstat(root);
  need(rootStat.isDirectory(),'SOURCE_BUNDLE_DIRECTORY_REQUIRED');
  const files=new Map();let total=0;
  for(const file of declared){
    const target=resolve(root,...file.split('/')),actual=await realpath(target),rel=relative(root,actual);
    need(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep),'SOURCE_BUNDLE_FILE_OUTSIDE_DIRECTORY');
    const bytes=await readBytes(target,SOURCE_FILE_BYTES_LIMIT);total+=bytes.length;
    need(total<=SOURCE_FILE_BYTES_LIMIT,'SOURCE_BUNDLE_FILES_TOO_LARGE');files.set(file,bytes);
  }
  return createSourceBundle({manifestBytes,files,manifestName:basename(manifestFile)});
}
