// MIT. SensorThings source editions -> the original SF30/SF82/SF88 engines.
import {open,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {privateDirectory,syncDir,readOwned} from '../stellar-expert/store.mjs';
import {hashPrivate} from '../postgres/publisher/files.mjs';
import {json,sha,identity,text,fault,SOURCE_CONTRACT} from './contract.mjs';
import {tableColumns,tableRows} from './domain.mjs';
export {queryNativeDataset,nativePublishers,prepareNativeRelease,inspectNativeRelease,controlNativeRelease,
  inspectBuyer,receiveBuyer,readBuyerOutput} from '../stellar-expert/dataset.mjs';
const csvCell=v=>/[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
export async function writeRetainedRows(store,path,columns,rows,{maxRows=250000,maxBytes=256*1024*1024}={}){
  const temp=path+'.'+randomUUID()+'.tmp',file=await open(temp,'wx',0o600),hash=createHash('sha256');let bytes=0,count=0;
  const write=async text=>{const body=Buffer.from(text);bytes+=body.length;if(bytes>maxBytes)throw fault('DATASET_CAPACITY','The complete CSV exceeds the original dataset byte capacity.',413);
    await file.writeFile(body);hash.update(body);};
  try{
    await write(columns.join(',')+'\n');
    for await(const item of rows){if(++count>maxRows)throw fault('DATASET_CAPACITY','The complete table exceeds the original native row capacity; retain the source and select a narrower edition.',413);
      const values=columns.map(k=>{const v=item.row[k]??'';if(typeof v!=='string'||v.length>65536)throw fault('DATASET_CELL','A source field exceeds the explicit CSV cell capacity.',413);return csvCell(v);});
      await write(values.join(',')+'\n');
    }
    await file.sync();
  }catch(e){await file.close();await unlink(temp).catch(()=>{});throw e;}
  await file.close();const sha256=hash.digest('hex');
  try{await link(temp,path);await syncDir(join(path,'..'));}
  catch(e){if(e.code!=='EEXIST')throw e;const before=await hashPrivate(path,maxBytes);
    if(before.hash!==sha256||before.bytes!==bytes)throw fault('DATASET_CHANGED','This original output path already contains different bytes.',409);}
  finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return {bytes,sha256,rows:count};
}
export async function prepareSensorThingsDataset(store,{edition,review,name,table='observations',id}){
  const columns=tableColumns(table);if(!columns)throw fault('TABLE','Choose observations, components or entities.');
  if(!/^dataset-[a-f0-9]{24}$/.test(id??''))throw fault('DATASET_ID','Use the original operation-bound dataset identity.');
  name=text(name,'the original dataset name',128);
  const directory=join(store.root,'datasets',id),packageDirectory=join(directory,'package');
  await privateDirectory(packageDirectory,{create:true});await privateDirectory(join(packageDirectory,'provenance'),{create:true});
  const projected=await writeRetainedRows(store,join(packageDirectory,'dataset.csv'),columns,tableRows(store,edition,table));
  const filterChoices=['stream_id','observation_id','result_type','result_state','entity_kind','entity_id'];
  const timeChoices=['phenomenon_start_utc','phenomenon_end_utc','result_time_utc'];
  const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,
    columns:Object.fromEntries(columns.map(k=>[k,'string'])),filters:filterChoices.filter(k=>columns.includes(k)),
    ranges:timeChoices.filter(k=>columns.includes(k)),sorts:[...timeChoices,'stream_id','observation_id','entity_id'].filter(k=>columns.includes(k)).slice(0,8),
    defaultLimit:50,maxLimit:200,maxBytes:256*1024*1024,maxRows:250000,maxCellChars:65536};
  await store.immutable(join(packageDirectory,'dataset.json'),json(config));
  const sourceFiles=[],seen=new Set();
  for(const item of edition.sourceFiles){
    if(seen.has(item.sha256))continue;seen.add(item.sha256);
    const body=await store.object(item.sha256);
    if(body.length!==item.bytes)throw fault('SOURCE_CHANGED','An original retained source member differs.',409);
    const path='provenance/object-'+item.sha256+'.'+(item.mediaType?.includes('json')?'json':'body');
    await store.immutable(join(packageDirectory,path),body);sourceFiles.push({path,bytes:body.length,sha256:item.sha256});
  }
  const editionBytes=json(edition),editionPath='provenance/edition.json';
  await store.immutable(join(packageDirectory,editionPath),editionBytes);
  sourceFiles.push({path:editionPath,bytes:editionBytes.length,sha256:sha(editionBytes)});
  const reviewBytes=json(review),reviewPath='provenance/review.json';await store.immutable(join(packageDirectory,reviewPath),reviewBytes);
  sourceFiles.push({path:reviewPath,bytes:reviewBytes.length,sha256:sha(reviewBytes)});
  const semantic={
    schema:'stellar-forge.sensorthings-semantics.v1',sourceContract:SOURCE_CONTRACT,editionId:edition.id,table,
    scope:edition.scope,licence:edition.source.license,columns,
    values:'All CSV fields are strings. Numeric JSON lexemes remain exact text and result_type distinguishes numbers, strings, booleans, arrays and objects.',
    presence:'Separate state columns preserve value, null and missing. An empty value string remains distinguishable through state=value and result_type=string.',
    time:'Original phenomenonTime, resultTime and validTime remain unchanged. Separate UTC columns normalize explicit calendar instants only to a common nine-digit fractional format; unresolved intervals, durations, leap seconds and excess precision remain source literals.',
    quality:'Original resultQuality and parameters are retained without inferred validation or calibration.',
    units:'Original unit declarations and observed-property entities travel with their source pointers. No conversion or semantic equivalence is assumed.',
    components:'Multidatastream components retain their original array index. Units/properties/types are attached only when all three metadata arrays align with the result array.',
    graph:'Thing, FeatureOfInterest and observed-property bodies include their exact source reference. Metadata capture is not atomic with observation capture.',
    comparison:'Observed keyed differences retain duplicate and unkeyed occurrences; no provider deletion or uptime is inferred.'
  };
  const semanticsBytes=json(semantic);await store.immutable(join(packageDirectory,'provenance','semantics.json'),semanticsBytes);
  sourceFiles.push({path:'provenance/semantics.json',bytes:semanticsBytes.length,sha256:sha(semanticsBytes)});
  const source={schema:'stellar-forge.sensorthings-dataset-source.v1',provider:SOURCE_CONTRACT,editionId:edition.id,
    sourceId:edition.source.id,serviceUrl:edition.source.serviceUrl,licence:edition.source.license,
    scope:edition.scope,table,rows:projected.rows,review,semantics:{path:'provenance/semantics.json',sha256:sha(semanticsBytes)},sourceFiles};
  const sourceBytes=json(source);await store.immutable(join(packageDirectory,'source.json'),sourceBytes);
  const {loadDatasetConfig}=await import('../dataset-handler.mjs'),native=await loadDatasetConfig(join(packageDirectory,'dataset.json')),description=native.describe();
  if(description.rowCount!==projected.rows)throw fault('DATASET_ROW_COUNT','The original native row count differs from the complete projection.',409);
  const record={id,editionId:edition.id,name,table,snapshot:description.snapshot,sourceSha256:edition.id,
    reviewSha256:identity(review),createdAt:edition.createdAt,rows:description.rowCount,columns:description.columns,description,
    csvSha256:projected.sha256,sourceConfigSha256:sha(json(config)),sourceManifestSha256:sha(sourceBytes),
    relativeDirectory:'datasets/'+id,relativePublisherDirectory:'datasets/'+id+'/publisher',mode:'ORIGINAL_SF30_DATASET',versionState:null};
  await store.immutable(join(directory,'dataset-receipt.json'),json(record));return record;
}
