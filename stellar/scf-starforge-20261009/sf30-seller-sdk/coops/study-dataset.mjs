// MIT. A reviewed coastal delivery enters the original SF30 query and publisher unchanged.
import {link,copyFile,unlink,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {privateDirectory,jsonBytes,stable,syncDir} from '../stellar-expert/store.mjs';
import {mappingValue,tableProjection,materializeExport,retainedExport,verifyRetainedFile} from './exports.mjs';
import {studyEditions,studyDigest,studyReview} from './study.mjs';
import {fault,text,hashBytes} from './provider.mjs';
import {SOURCE_CONTRACT} from './schema.mjs';

const ROWS=250000,BYTES=256*1024*1024,SHA=/^[a-f0-9]{64}$/;
const checkedId=(value,prefix)=>typeof value==='string'&&new RegExp('^'+prefix+'-[a-f0-9]{24}$').test(value);
const same=(a,b)=>stable(a)===stable(b);
function originalSelection(release){
 if(!release||release.schema!=='stellar-forge.coops-study-release.v1'||!checkedId(release.id,'study-release')||
    !release.study||release.study.id!==release.studyId||release.study.revision!==release.studyRevision||
    release.study.sha256!==release.studySha256||studyDigest(release.study.selection)!==release.studySha256)
  throw fault('COOPS_STUDY_DATASET_RELEASE','Select the original immutable study delivery and its exact study revision.',409);
 const {study,review,manifest}=release;
 if(!review||review.status!=='reviewed'||review.studyId!==study.id||
    !same(studyReview(study,review,review.id,review.createdAt),review))
  throw fault('COOPS_STUDY_DATASET_REVIEW','The delivered source review does not match the exact selected study.',409);
 if(!manifest||manifest.schema!=='stellar-forge.coops-study-delivery.v1'||manifest.id!==release.id||
    manifest.studyId!==study.id||manifest.studyRevision!==study.revision||manifest.studySha256!==study.sha256||
    hashBytes(jsonBytes(manifest))!==release.manifestSha256||!same(manifest.review,review)||
    !same(manifest.mapping,study.selection.mapping)||!same(manifest.selection,study.selection.members)||
    !same(manifest.counts,release.counts))
  throw fault('COOPS_STUDY_DATASET_MANIFEST','The original released manifest, review and source selection disagree.',409);
 const csv=release.files.filter(f=>f.format==='csv');
 if(csv.length!==1)throw fault('COOPS_STUDY_DATASET_CSV','Choose the one complete CSV from the original study delivery.',409);
 const file=csv[0],member=manifest.files.find(f=>f.path==='model-input.csv');
 if(!member||member.exportId!==file.id||member.bytes!==file.bytes||member.sha256!==file.sha256||
    file.studyId!==study.id||file.studyRevision!==study.revision||file.studySha256!==study.sha256||
    !same(file.result?.counts,release.counts)||!same(file.result?.columns,manifest.columns))
  throw fault('COOPS_STUDY_DATASET_CSV','The selected CSV is not the exact complete released table.',409);
 if(!Number.isSafeInteger(release.counts.rows)||release.counts.rows<0||!Number.isSafeInteger(file.bytes)||file.bytes<0)
  throw fault('COOPS_STUDY_DATASET_CSV','The original complete row/byte count is unavailable.',409);
 if(release.counts.rows>ROWS||file.bytes>BYTES)
  throw fault('COOPS_STUDY_DATASET_CAPACITY','This complete reviewed CSV exceeds the original SF30 query limit of 250000 rows or 256 MiB. Save and review an explicitly narrower study, then release its complete CSV. The existing complete delivery is preserved.',413);
 const mapping=study.selection.mapping;
 if(!checkedId(mapping?.id,'mapping')||!Number.isSafeInteger(mapping.revision)||mapping.revision<1)
  throw fault('COOPS_STUDY_DATASET_MAPPING','Keep the original saved mapping revision from this delivered study.',409);
 mappingValue(mapping);
 const {columns,fields}=tableProjection(mapping,study.selection.table),aliases=new Map(fields.map((field,i)=>[field,columns[i]]));
 if(!same(columns,manifest.columns))throw fault('COOPS_STUDY_DATASET_MAPPING','The original release columns differ from its saved mapping.',409);
 const invalid=columns.filter(name=>!(/^[A-Za-z][A-Za-z0-9_]{0,47}$/).test(name)||['constructor','prototype','__proto__'].includes(name));
 if(invalid.length)throw fault('COOPS_DATASET_COLUMNS','The delivered headings are not valid native SF30 query names: '+invalid.join(', ')+'. Save an explicit mapping/study revision and release it after review; the existing CSV will not be renamed.');
 if(aliases.has('value')&&!aliases.has('valueType'))throw fault('COOPS_DATASET_VALUE_TYPE','Keep the original valueType beside value in the reviewed query selection.');
 const nativeFields=values=>values.filter(field=>aliases.has(field)).map(field=>aliases.get(field));
 return{file,mapping,columns,fields,filters:nativeFields(['stationId','product','field','quality','datum','timeZone','recordId','unit']),
  ranges:nativeFields(['timestampUtc']),sorts:nativeFields(['timestampUtc','product','field','stationId'])};
}
async function retainCSV(store,file,packageDirectory){
 const original=await retainedExport(store,file),target=join(packageDirectory,'dataset.csv');
 try{await link(original.path,target);}
 catch(error){
  if(error.code==='EEXIST'){await verifyRetainedFile(target,file);await syncDir(packageDirectory);return;}
  if(error.code!=='EXDEV')throw error;
  // Cross-device private layouts keep the same complete bytes through a bounded file copy.
  const temporary=join(packageDirectory,'.dataset.csv.'+randomBytes(12).toString('hex')+'.tmp');
  try{
   await copyFile(original.path,temporary,constants.COPYFILE_EXCL);
   await verifyRetainedFile(temporary,file);
   const handle=await open(temporary,constants.O_RDONLY|constants.O_NOFOLLOW);try{await handle.sync();}finally{await handle.close();}
   try{await link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;await verifyRetainedFile(target,file);}
  }finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 await verifyRetainedFile(target,file);await syncDir(packageDirectory);
}
export async function prepareStudyDataset(store,{release,id,name,createdAt}){
 if(!checkedId(id,'dataset'))throw fault('COOPS_STUDY_DATASET_ID','Use the dataset identity from the original reserved operation.');
 name=text(name,'a dataset name',128);
 const selected=originalSelection(release),{study,review,manifest}=release,editions=await studyEditions(store,study),
  directory=join(store.root,'datasets',id),packageDirectory=await privateDirectory(join(directory,'package'),{create:true});
 const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,
  columns:Object.fromEntries(selected.columns.map(key=>[key,'string'])),filters:selected.filters,ranges:selected.ranges,sorts:selected.sorts,
  maxBytes:BYTES,maxRows:ROWS,defaultLimit:50,maxLimit:200};
 await retainCSV(store,selected.file,packageDirectory);
 await store.immutable(join(packageDirectory,'dataset.json'),jsonBytes(config));
 await privateDirectory(join(packageDirectory,'provenance'),{create:true});
 const sourceFiles=[];
 async function retainFile(path,bytes,expected={}){
  if(!/^provenance\/[A-Za-z0-9_.-]+$/.test(path))throw fault('COOPS_STUDY_DATASET_PATH','Keep original source files in the native flat provenance directory.');
  const sha256=hashBytes(bytes);
  if(expected.bytes!==undefined&&bytes.length!==expected.bytes||expected.sha256!==undefined&&sha256!==expected.sha256)
   throw fault('COOPS_STUDY_DATASET_SOURCE','A retained source file differs from its original byte count or digest.',409);
  await store.immutable(join(packageDirectory,path),bytes);
  const descriptor={path,bytes:bytes.length,sha256};sourceFiles.push(descriptor);return descriptor;
 }
 const studyFile=await retainFile('provenance/study.json',jsonBytes(study)),
  reviewFile=await retainFile('provenance/study-review.json',jsonBytes(review)),
  manifestFile=await retainFile('provenance/study-delivery-manifest.json',jsonBytes(manifest),{sha256:release.manifestSha256}),
  releaseFile=await retainFile('provenance/study-release.json',jsonBytes(release)),
  mappingFile=await retainFile('provenance/model-input-mapping.json',jsonBytes(selected.mapping));
 let mappingOriginalFile=null;
 if(selected.mapping.sourceFile){
  const source=selected.mapping.sourceFile;
  mappingOriginalFile={...await retainFile('provenance/mapping-source-'+source.sha256+'.json',await store.object(source.sha256),source),filename:source.filename};
 }
 const editionFiles=[],responseFiles=[],capturePackageFiles=[],expectedResponses=new Map();
 for(const e of editions.values()){
  editionFiles.push({editionId:e.id,...await retainFile('provenance/edition-'+e.id+'.json',jsonBytes(e))});
  for(const page of [...e.pages,...(e.failedResponses??[])]){
   if(!SHA.test(page.sha256)||!Number.isSafeInteger(page.bytes)||page.bytes<0)throw fault('COOPS_STUDY_DATASET_SOURCE','The original response identity is incomplete.',409);
   const prior=expectedResponses.get(page.sha256);
   if(prior&&prior.bytes!==page.bytes)throw fault('COOPS_STUDY_DATASET_SOURCE','One original response digest carries different byte counts.',409);
   expectedResponses.set(page.sha256,{sha256:page.sha256,bytes:page.bytes});
  }
 }
 const retainedResponses=new Set();
 for(const source of manifest.sourceResponses){
  const expected=expectedResponses.get(source.sha256);
  if(!expected||expected.bytes!==source.bytes||retainedResponses.has(source.sha256))
   throw fault('COOPS_STUDY_DATASET_SOURCE','The delivered response register differs from its exact source editions.',409);
  retainedResponses.add(source.sha256);
  responseFiles.push({...await retainFile('provenance/response-'+source.sha256+'.json',await store.object(source.sha256),expected),
   originalArchivePath:source.path,uses:structuredClone(source.uses)});
 }
 if(retainedResponses.size!==expectedResponses.size)throw fault('COOPS_STUDY_DATASET_SOURCE','The delivery omitted a selected original response.',409);
 const retainedPackages=new Map();
 for(const e of editions.values())if(e.sourcePackageSha256){
  let descriptor=retainedPackages.get(e.sourcePackageSha256);
  if(!descriptor){descriptor=await retainFile('provenance/capture-package-'+e.sourcePackageSha256+'.json',await store.object(e.sourcePackageSha256),{sha256:e.sourcePackageSha256});retainedPackages.set(e.sourcePackageSha256,descriptor);}
  capturePackageFiles.push({editionId:e.id,...descriptor});
 }
 const selection={schema:'stellar-forge.coops-study-dataset-selection.v1',studyReleaseId:release.id,studyId:study.id,
  studyRevision:study.revision,studySha256:study.sha256,manifestSha256:release.manifestSha256,reviewId:review.id,
  reviewSha256:reviewFile.sha256,table:study.selection.table,members:structuredClone(study.selection.members),
  reviewScope:'The exact decision recorded in this immutable delivery. A later study or review remains a separate working record.'};
 const source={schema:'stellar-forge.coops-study-dataset-source.v1',sourceKind:'reviewed-study',provider:SOURCE_CONTRACT,
  selection,studyFile,reviewFile,manifestFile,releaseFile,editionFiles,responseFiles,capturePackageFiles,
  mapping:structuredClone(selected.mapping),mappingFile,mappingOriginalFile,
  csv:{path:'dataset.csv',exportId:selected.file.id,bytes:selected.file.bytes,sha256:selected.file.sha256,rows:release.counts.rows},
  counts:structuredClone(release.counts),warnings:structuredClone(study.selection.warnings),
  projection:{columns:selected.columns,originalFields:selected.fields,
   queryCapabilities:{filters:config.filters,ranges:config.ranges,sorts:config.sorts},
   values:'The exact released CSV enters the original SF30 parser as strings. Source null, absent, empty and recorded zero remain distinguishable through valueType. No arithmetic, resampling or unit/datum/time conversion is performed.',
   order:'The complete released member/response order is retained in the CSV; explicit query sorts and original cursors are applied only by the native dataset engine.'},
  packageScope:'Exact released CSV, study and recorded review, original delivery manifest/receipt, original mapping bytes, complete selected source editions and all accepted/failed response bodies plus any retained imported capture package. Other formatted delivery files remain in the original workspace; this native query package does not duplicate the JSONL, HTML and TAR.',
  sourceFiles};
 const sourceBytes=jsonBytes(source);
 if(sourceBytes.length>16*1024*1024)throw fault('COOPS_STUDY_DATASET_CAPACITY','The complete native source manifest exceeds the original publisher metadata limit of 16 MiB. Keep this release and prepare an explicitly smaller source selection.',413);
 await store.immutable(join(packageDirectory,'source.json'),sourceBytes);
 const {loadDatasetConfig}=await import('../dataset-handler.mjs'),dataset=await loadDatasetConfig(join(packageDirectory,'dataset.json')),description=dataset.describe();
 if(description.rowCount!==release.counts.rows)throw fault('COOPS_STUDY_DATASET_ROWS','The original SF30 parser did not retain every row of the released CSV.',409);
 const files=[];
 for(const [format,filename,body] of [['dataset-source','Coastal_Study_Native_Source.json',sourceBytes],['dataset-config','Coastal_Study_Native_Dataset.json',jsonBytes(config)]]){
  files.push(await materializeExport(store,{id:'export-'+hashBytes(Buffer.from(id+':'+format)).slice(0,24),kind:'study-dataset',datasetId:id,
   studyReleaseId:release.id,studyId:study.id,studyRevision:study.revision,studySha256:study.sha256,format,
   name:id+'-'+filename,type:'application/json; charset=utf-8',createdAt},async function*(){yield body;}));
 }
 const receipt={id,sourceKind:'reviewed-study',editionId:null,profileId:null,table:study.selection.table,name,
  studyReleaseId:release.id,studyId:study.id,studyRevision:study.revision,studySha256:study.sha256,
  studyManifestSha256:release.manifestSha256,studyName:study.selection.name,review:{...structuredClone(review),sha256:reviewFile.sha256},
  selection,snapshot:description.snapshot,sourceSha256:release.manifestSha256,sourceSha256Basis:'Exact released study-delivery manifest bytes',
  createdAt,rows:description.rowCount,files,mapping:{id:selected.mapping.id,revision:selected.mapping.revision,name:selected.mapping.name,
   table:selected.mapping.table,columns:structuredClone(selected.mapping.columns),sha256:mappingFile.sha256,sourceFileSha256:mappingOriginalFile?.sha256??null},
  columns:description.columns,description,csvSha256:selected.file.sha256,csvBytes:selected.file.bytes,originalCSVExportId:selected.file.id,
  sourceConfigSha256:hashBytes(jsonBytes(config)),sourceManifestSha256:hashBytes(sourceBytes),versionState:null,
  relativeDirectory:'datasets/'+id,relativePublisherDirectory:'datasets/'+id+'/publisher',mode:'ORIGINAL_SF30_DATASET'};
 await store.immutable(join(directory,'dataset-receipt.json'),jsonBytes(receipt));return receipt;
}
