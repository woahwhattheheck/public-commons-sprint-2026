// MIT. Complete original Datasette editions retained by the maintained publisher.
import { join,dirname } from 'node:path';
import { loadCsvDataset } from '../dataset-handler.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { object,bytes,digest,identity,readPrivate,createFile,privateDirectory,syncDirectory,fault } from '../postgres/publisher/files.mjs';
import { datasetteMember } from './capture.mjs';
import { inspectDatasetteSource,openDatasetteSourceFile,checkDatasetteColumnTypes,encodeDatasetteRow,datasetteDatasetSemantics } from './source.mjs';
const HASH=/^[a-f0-9]{64}$/;
const only=(value,keys,code)=>{if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))throw fault(code);};
export async function retainPublisherDatasetteEdition(selected,target) {
  await privateDirectory(target,true);
  const directory=dirname(selected.editionFile),seen=new Set();
  for(const item of selected.edition.files){
    const name=datasetteMember(item.file);
    if(name==='edition.json'||seen.has(name)||!HASH.test(item.sha256??'')||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>67108864)throw fault('DATASETTE_EDITION_FILES_INVALID');
    seen.add(name);
    const raw=await readPrivate(join(directory,name),67108864);
    if(raw.length!==item.bytes||digest(raw)!==item.sha256)throw fault('DATASETTE_EDITION_MEMBER_CHANGED');
    await privateDirectory(dirname(join(target,name)),true);
    await createFile(join(target,name),raw);await syncDirectory(dirname(join(target,name)));
  }
  const editionBytes=await readPrivate(selected.editionFile,16777216);
  if(digest(editionBytes)!==selected.editionSha256)throw fault('DATASETTE_EDITION_CHANGED');
  await createFile(join(target,'edition.json'),editionBytes);await syncDirectory(target);
}
export async function captureDatasettePlan(sourceFile,directory,input) {
  only(input,['title','query','input','dataset','extraction','sourceHash'],'INVALID_PUBLICATION_PLAN');
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>128)throw fault('PLAN_TITLE_REQUIRED');
  const selected=await inspectDatasetteSource(sourceFile),original=await readPrivate(sourceFile,1024*1024);
  if(selected.hash!==input.sourceHash||digest(original)!==selected.hash)throw fault('SOURCE_REVIEW_CHANGED','Reload the original selected Datasette edition before saving this plan.',409);
  const query=selected.queries[input.query];if(!query)throw fault('QUERY_NOT_FOUND');
  if(!object(input.input??{})||Object.keys(input.input??{}).length)throw fault('DATASETTE_QUERY_INPUT_NOT_SUPPORTED');
  const extraction=datasetExtractionOptions(query,input.extraction);
  only(input.dataset,['name','columns','filters','ranges','sorts','maxCellChars','defaultLimit','maxLimit','maxPageBytes'],'INVALID_DATASET_PLAN');
  if(!object(input.dataset.columns)||!Object.keys(input.dataset.columns).length||Object.keys(input.dataset.columns).length>64)throw fault('DATASETTE_DATASET_COLUMNS_REQUIRED');
  const columns=Object.fromEntries(Object.entries(input.dataset.columns).map(([name,spec])=>{
    const value=typeof spec==='string'?{type:spec,nullable:false}:spec;
    only(value,['type','nullable'],'INVALID_DATASET_COLUMN');
    return [name,{type:value.type,nullable:value.nullable??false}];
  }));
  checkDatasetteColumnTypes(columns,query.columnTypes);
  const dataset={schema:'stellar-forge.csv-dataset.v1',file:'data.csv',name:input.dataset.name,columns,
    filters:input.dataset.filters??[],ranges:input.dataset.ranges??[],sorts:input.dataset.sorts??[],
    maxBytes:extraction.maxBytes,maxRows:extraction.maxRows,maxCellChars:input.dataset.maxCellChars??65536,
    defaultLimit:input.dataset.defaultLimit??50,maxLimit:input.dataset.maxLimit??250,maxPageBytes:input.dataset.maxPageBytes??921600,
    semantics:datasetteDatasetSemantics(selected,columns)};
  if(bytes(dataset).length>65536)throw fault('DATASETTE_DATASET_CONFIGURATION_LIMIT','The complete native dataset configuration must fit64KiB.',413);
  await createFile(join(directory,'schema.csv'),csvLine(Object.keys(columns)));
  await loadCsvDataset({...dataset,file:join(directory,'schema.csv')});
  await retainPublisherDatasetteEdition(selected,join(directory,'edition'));
  const runtime={...selected.config,edition:'edition/edition.json'},runtimeBytes=bytes(runtime);
  await createFile(join(directory,'original-source.json'),original);await createFile(join(directory,'source.json'),runtimeBytes);
  const value={schema:'stellar-forge.datasette-dataset-plan.v1',title:input.title.trim(),query:input.query,input:{},dataset,extraction,
    sourceHash:selected.hash,sourceBytes:original.length,runtimeSourceHash:digest(runtimeBytes),queryHash:identity(query),
    retainedEdition:{path:'edition/edition.json',sha256:selected.editionSha256,captureSha256:selected.captureSha256,
      reviewDigest:selected.review.digest,sourceSelectionHash:selected.capture.selectionHash,
      name:selected.edition.name,metadata:selected.capture.selection.metadata??null},
    sourceQuery:query};
  value.digest=identity(value);
  await createFile(join(directory,'plan.json'),bytes(value));return value;
}
export const datasettePublisherDriver=Object.freeze({
  sourceName:'Datasette',workspaceSchema:'stellar-forge.datasette-publisher-workspace.v1',
  statusSchema:'stellar-forge.datasette-publisher-status.v1',candidateSchema:'stellar-forge.datasette-dataset-candidate.v1',
  capturePlan:captureDatasettePlan,inspectSource:inspectDatasetteSource,openSource:openDatasetteSourceFile,
  checkColumnTypes:checkDatasetteColumnTypes,encodeRow:encodeDatasetteRow,
  validateExtraction:value=>value?.schema==='stellar-forge.datasette-extraction.v1'&&
    value.valueEncoding==='datasette-reviewed-original-projection'&&value.nullEncoding==='reviewed-native-or-json'&&
    value.tieBreak==='original-captured-page-and-row-order'&&HASH.test(value.editionSha256??'')&&
    HASH.test(value.captureSha256??'')&&HASH.test(value.reviewDigest??'')&&
    Number.isSafeInteger(value.rowCount)&&value.rowCount>=0&&Array.isArray(value.columnTypes)&&
    Array.isArray(value.columns)&&Array.isArray(value.order)&&object(value.consistency),
});
