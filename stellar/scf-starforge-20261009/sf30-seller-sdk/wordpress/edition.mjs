// MIT. Native WordPress records -> reviewed original SF30 dataset editions.
import { createHash } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { sourceString, projectRecord } from '../sftp/formats.mjs';
import { encodeSftpDatasetRow } from '../sftp/publisher/plan.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { loadCsvDataset, loadDatasetConfig } from '../dataset-handler.mjs';
import { privateDirectory, immutableJson, immutableBytes, readJson, hashPrivate, exists, syncDirectory } from './files.mjs';
import { EDITION_SCHEMA, object, only, text, integer, identity, sha256, jsonBytes, clone, now, pointer, fail, newId } from './config.mjs';
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const nativeText = value => value === null || value === undefined ? '' : sourceString(value);
export function normalizedRecord(row, discovery) {
  const native = row.native, terms = Object.create(null);
  for (const collection of discovery.collections.filter(item => item.kind === 'term')) {
    const key = collection.restBase;
    if (Object.hasOwn(native,key)) terms[key] = native[key];
  }
  const record = { key: row.key, collection: row.collection, kind: row.kind, native_id: row.nativeId,
    status: nativeText(native.status), slug: nativeText(native.slug),
    title_html: nativeText(native.title?.rendered ?? native.title?.raw ?? native.name),
    url: nativeText(native.link), date_gmt: nativeText(native.date_gmt), modified_gmt: nativeText(native.modified_gmt),
    parent_id: nativeText(native.parent), author_id: nativeText(native.author), featured_media_id: nativeText(native.featured_media),
    content_html: nativeText(native.content?.rendered ?? native.content?.raw ?? native.description),
    excerpt_html: nativeText(native.excerpt?.rendered ?? native.excerpt?.raw ?? native.caption?.rendered),
    mime_type: nativeText(native.mime_type), media_url: nativeText(native.source_url), taxonomy_json: sourceString(terms),
    native_json: sourceString(native), response_sha256: row.responseSha256, observed_at: row.observedAt };
  return { record, native };
}
export function suggestedProjection(capture) {
  const names = ['key','collection','kind','native_id','status','slug','title_html','url','date_gmt','modified_gmt','parent_id','author_id','featured_media_id','content_html','excerpt_html','mime_type','media_url','taxonomy_json'];
  return { schema: 'stellar-forge.wordpress-projection.v1', label: 'Native WordPress content',
    collections: capture.selection.collections.map(item => item.key), duplicatePolicy: 'last',
    mapping: Object.fromEntries(names.map(name => [name, { pointer: '/record/' + name,
      type: name === 'native_id' ? 'integer' : 'string', nullable: false, missing: 'error' }])) };
}
export function validateProjection(value, capture) {
  only(value, ['schema','label','collections','duplicatePolicy','mapping'], 'projection');
  if (value.schema !== 'stellar-forge.wordpress-projection.v1') fail('WORDPRESS_PROJECTION_SCHEMA', 'Use the WordPress projection schema.');
  text(value.label,160,'the projection label');
  const available = new Set(capture.selection.collections.map(item => item.key));
  if (!Array.isArray(value.collections) || !value.collections.length || new Set(value.collections).size !== value.collections.length ||
      value.collections.some(key => !available.has(key))) fail('WORDPRESS_PROJECTION_COLLECTIONS', 'Select collections retained in the reviewed capture.');
  if (!['first','last','error'].includes(value.duplicatePolicy)) fail('WORDPRESS_DUPLICATE_POLICY', 'Choose first, last or error for repeated native IDs.');
  if (!object(value.mapping) || !Object.keys(value.mapping).length || Object.keys(value.mapping).length > 64)
    fail('WORDPRESS_PROJECTION_COLUMNS', 'Declare one to 64 original dataset columns.');
  const mapping = {};
  for (const [name,spec] of Object.entries(value.mapping)) {
    if (!NAME.test(name) || ['constructor','prototype','__proto__'].includes(name)) fail('WORDPRESS_COLUMN_NAME','Use an original dataset column name.');
    only(spec,['pointer','type','nullable','missing'],'column mapping');
    pointer({},spec.pointer);
    if (!['string','integer','number','boolean'].includes(spec.type) || typeof spec.nullable !== 'boolean' ||
        !['error','null'].includes(spec.missing) || spec.missing === 'null' && !spec.nullable)
      fail('WORDPRESS_COLUMN_TYPE', 'Declare the original column type, nullability and missing-field treatment.');
    mapping[name] = clone(spec);
  }
  return { schema:value.schema,label:value.label,collections:[...value.collections],duplicatePolicy:value.duplicatePolicy,mapping };
}
export function datasetConfig(projection, input) {
  only(input,['name','filters','ranges','sorts','maxBytes','maxRows','maxCellChars','defaultLimit','maxLimit','maxPageBytes'],'dataset');
  return { schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name:text(input.name,128,'the dataset name'),
    columns:Object.fromEntries(Object.entries(projection.mapping).map(([name,spec])=>[name,{type:spec.type,nullable:spec.nullable}])),
    filters:clone(input.filters??[]),ranges:clone(input.ranges??[]),sorts:clone(input.sorts??[]),
    maxBytes:integer(input.maxBytes??67108864,1,268435456,'dataset bytes'),
    maxRows:integer(input.maxRows??250000,1,1000000,'dataset records'),
    maxCellChars:integer(input.maxCellChars??1048576,1,1048576,'cell characters'),
    defaultLimit:integer(input.defaultLimit??50,1,1000,'default page size'),
    maxLimit:integer(input.maxLimit??250,1,1000,'maximum page size'),
    maxPageBytes:integer(input.maxPageBytes??921600,1024,921600,'page bytes') };
}
export async function projectionPreview(source, captureId, requested, { offset=0,limit=20 }={}) {
  const capture=await source.completion(captureId), selected=await source.inspect(captureId),
    projection=validateProjection(requested,capture), query={format:'json',mapping:projection.mapping};
  integer(offset,0,1000000,'the preview offset');integer(limit,1,100,'the preview count');
  const index=await selectedRows(source,captureId,projection), rows=[], observed={};
  let ordinal=0;
  for await(const item of source.records(captureId)) {
    if(index.get(item.key)!==rowPosition(item)) continue;
    const original=normalizedRecord(item,selected.intent.input.discovery), result=projectRecord(original,query);
    for(const [name,type] of Object.entries(result.observed)) {observed[name]??={};observed[name][type]=(observed[name][type]??0)+1;}
    if(ordinal>=offset&&rows.length<limit) rows.push({key:item.key,row:result.row,responseSequence:item.responseSequence});
    ordinal++;
  }
  return {captureId,captureSha256:capture.sha256,projectionHash:identity(projection),projection,recordCount:ordinal,
    offset,limit,rows,columnObservations:observed,nextOffset:offset+limit<ordinal?offset+limit:null};
}
const rowPosition=row=>row.responseSequence+':'+row.ordinal;
async function selectedRows(source,captureId,projection) {
  const allowed=new Set(projection.collections), index=new Map();
  for await(const row of source.records(captureId)) {
    if(!allowed.has(row.collection)) continue;
    if(index.has(row.key)) {
      if(projection.duplicatePolicy==='error') fail('WORDPRESS_DUPLICATE_NATIVE_ID','The source contains a repeated native ID.',409,{key:row.key});
      if(projection.duplicatePolicy==='first') continue;
    }
    index.set(row.key,rowPosition(row));
  }
  return index;
}
export async function buildEdition({source,captureId,projection:requested,dataset:supplied,review,destination,signal}={}) {
  const capture=await source.completion(captureId), selected=await source.inspect(captureId),
    projection=validateProjection(requested,capture),config=datasetConfig(projection,supplied);
  only(review,['reviewer','note','decision','expectedCaptureSha256','projectionHash'],'edition review');
  text(review.reviewer,160,'the reviewer');text(review.note??'',4000,'the review note',true);
  if(review.decision!=='approve'||review.expectedCaptureSha256!==capture.sha256||review.projectionHash!==identity(projection))
    fail('WORDPRESS_EDITION_REVIEW','Review the exact completed capture and selected projection.',409);
  const desired={captureId,captureSha256:capture.sha256,projection,config,review:clone(review)},intentSha256=identity(desired);
  await privateDirectory(destination,true);
  let intent;
  if(await exists(join(destination,'intent.json'))) {
    intent=await readJson(join(destination,'intent.json'),1048576);
    if(intent.intentSha256!==intentSha256) fail('WORDPRESS_EDITION_ID_REUSED','This edition already belongs to a different original review.',409);
  } else {
    intent={schema:'stellar-forge.wordpress-edition-intent.v1',...desired,intentSha256,createdAt:now()};
    await immutableJson(join(destination,'intent.json'),intent);
  }
  if(await exists(join(destination,'edition.json'))) {
    const edition=await readEdition(destination);
    if(edition.intentSha256!==intentSha256) fail('WORDPRESS_EDITION_CHANGED','The saved edition belongs to a different review.',409);
    return edition;
  }
  const headers=Object.keys(config.columns);
  await immutableBytes(join(destination,'schema.csv'),Buffer.from(csvLine(headers)));
  await loadCsvDataset({...config,file:join(destination,'schema.csv')});
  const chosen=await selectedRows(source,captureId,projection), query={format:'json',mapping:projection.mapping},
    temporary=join(destination,'.pending-csv-'+newId()), handle=await open(temporary,'wx',0o600);
  const csvDigest=createHash('sha256'), indices=[],columnTypes={};let rowCount=0,csvBytes=0;
  async function write(bytes) {
    bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    if(csvBytes+bytes.length>config.maxBytes) fail('WORDPRESS_DATASET_BYTES','The original dataset exceeds its selected byte ceiling.',413);
    await handle.writeFile(bytes);csvDigest.update(bytes);csvBytes+=bytes.length;
  }
  try {
    await write(csvLine(headers));
    for await(const item of source.records(captureId)) {
      signal?.throwIfAborted();
      if(chosen.get(item.key)!==rowPosition(item)) continue;
      if(rowCount>=config.maxRows) fail('WORDPRESS_DATASET_ROWS','The original dataset exceeds its selected row ceiling.',413);
      const result=projectRecord(normalizedRecord(item,selected.intent.input.discovery),query);
      await write(encodeSftpDatasetRow(result.row,config));
      for(const [name,type] of Object.entries(result.observed)) {columnTypes[name]??={};columnTypes[name][type]=(columnTypes[name][type]??0)+1;}
      indices.push({key:item.key,collection:item.collection,nativeId:item.nativeId,responseSequence:item.responseSequence,
        responseSha256:item.responseSha256,ordinal:item.ordinal,nativeSha256:sha256(sourceString(item.native)),
        projectedSha256:identity(result.row)});
      rowCount++;
    }
    await handle.sync();
  } catch(error) {await unlink(temporary).catch(()=>{});throw error;}
  finally {await handle.close();}
  const csvSha256=csvDigest.digest('hex'),final=join(destination,'dataset.csv');
  if(await exists(final)) {
    const prior=await hashPrivate(final,config.maxBytes);
    if(prior.hash!==csvSha256||prior.bytes!==csvBytes) fail('WORDPRESS_EDITION_CHANGED','The retained dataset differs from the same original source.',409);
    await unlink(temporary);
  } else {await rename(temporary,final);await syncDirectory(destination);}
  await immutableJson(join(destination,'dataset.json'),config);
  const native=await loadDatasetConfig(join(destination,'dataset.json'));
  if(native.describe().rowCount!==rowCount) fail('WORDPRESS_DATASET_ROW_COUNT','The original native dataset has a different row count.',409);
  const sourceRecord={schema:'stellar-forge.wordpress-dataset-source.v1',sourceSha256:capture.sourceSha256,
    apiRoot:capture.apiRoot,context:capture.context,capture:{id:capture.id,sha256:capture.sha256,startedAt:capture.startedAt,
      completedAt:capture.completedAt,findings:capture.findings,collections:capture.collections},
    projection,projectionHash:identity(projection),review:clone(review),columnTypes};
  await immutableJson(join(destination,'source.json'),sourceRecord,1048576);
  await immutableJson(join(destination,'records.json'),{schema:'stellar-forge.wordpress-record-index.v1',records:indices},67108864);
  const edition={schema:EDITION_SCHEMA,builtAt:intent.createdAt,intentSha256,captureId,captureSha256:capture.sha256,
    sourceSha256:capture.sourceSha256,projectionHash:identity(projection),projection,rowCount,csvBytes,csvSha256,
    sourceSha256File:sha256(jsonBytes(sourceRecord)),configSha256:sha256(jsonBytes(config)),dataset:native.describe(),review:clone(review),columnTypes,
    recordIndexSha256:identity(indices)};
  await immutableJson(join(destination,'edition.json'),edition);
  return {...edition,directory:destination};
}
export async function readEdition(directory) {
  const edition=await readJson(join(directory,'edition.json'),1048576);
  if(edition.schema!==EDITION_SCHEMA) fail('WORDPRESS_EDITION_SCHEMA','Select an original WordPress edition.',409);
  const csv=await hashPrivate(join(directory,'dataset.csv'),268435456),native=await loadDatasetConfig(join(directory,'dataset.json')),
    source=await hashPrivate(join(directory,'source.json'),1048576),config=await hashPrivate(join(directory,'dataset.json'),65536),
    index=await readJson(join(directory,'records.json'),67108864);
  if(csv.hash!==edition.csvSha256||csv.bytes!==edition.csvBytes||native.describe().snapshot!==edition.dataset.snapshot||
     source.hash!==edition.sourceSha256File||config.hash!==edition.configSha256||identity(index.records)!==edition.recordIndexSha256)
    fail('WORDPRESS_EDITION_CHANGED','The retained edition differs from its original dataset and source.',409);
  return {...edition,directory};
}
export async function compareEditions(beforeDirectory,afterDirectory,{offset=0,limit=100}={}) {
  integer(offset,0,1000000,'the comparison offset');integer(limit,1,500,'the comparison count');
  const before=await readEdition(beforeDirectory),after=await readEdition(afterDirectory),
    left=(await readJson(join(beforeDirectory,'records.json'),67108864)).records,
    right=(await readJson(join(afterDirectory,'records.json'),67108864)).records,
    previous=new Map(left.map(row=>[row.key,row])),next=new Map(right.map(row=>[row.key,row]));
  const changes=[],counts={added:0,removed:0,sourceChanged:0,projectionChanged:0,unchanged:0};
  for(const key of [...new Set([...previous.keys(),...next.keys()])].sort()) {
    const old=previous.get(key),current=next.get(key);
    const kind=!old?'added':!current?'removed':old.nativeSha256!==current.nativeSha256?'sourceChanged':
      old.projectedSha256!==current.projectedSha256?'projectionChanged':'unchanged';
    counts[kind]++;
    if(kind!=='unchanged')changes.push({key,kind,before:old??null,after:current??null});
  }
  return {before:{captureId:before.captureId,captureSha256:before.captureSha256,snapshot:before.dataset.snapshot},
    after:{captureId:after.captureId,captureSha256:after.captureSha256,snapshot:after.dataset.snapshot},
    sameSource:before.sourceSha256===after.sourceSha256,sameProjection:before.projectionHash===after.projectionHash,
    sameCollections:identity(before.projection.collections)===identity(after.projection.collections),
    counts,offset,limit,changes:changes.slice(offset,offset+limit),changeCount:changes.length,nextOffset:offset+limit<changes.length?offset+limit:null};
}
