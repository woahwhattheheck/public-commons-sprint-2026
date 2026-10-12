// MIT — Complete reviewed source-bundle receiving in the original Research case.
// Run as a following stage of the existing native owner; input and source stay private.
import {readFile,mkdir,rename,open,lstat,link,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const need=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const same=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const now=()=>new Date().toISOString();
const absolute=(value,name)=>{need(typeof value==='string'&&resolve(value)===value,name+'_ABSOLUTE_PATH_REQUIRED');return value;};
const inputBytes=await readFile(process.argv[2]),input=JSON.parse(inputBytes);
need(input.schema==='sf88.research-client.source-bundle-receiving-input.v1','ORIGINAL_SOURCE_BUNDLE_RECEIVING_INPUT_REQUIRED');
for(const key of ['operationId','stageId'])need(typeof input[key]==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(input[key]),'ORIGINAL_OPERATION_REQUIRED');
need(/^d_[a-f0-9-]{36}$/.test(input.dossierId)&&/^q_[a-f0-9-]{36}$/.test(input.questionId),'ORIGINAL_DOSSIER_AND_QUESTION_REQUIRED');
need(typeof input.questionText==='string'&&input.questionText.length>0,'ORIGINAL_QUESTION_TEXT_REQUIRED');
need(/^[a-f0-9]{40}$/.test(input.sourceCommit),'CURRENT_SOURCE_COMMIT_REQUIRED');
for(const key of ['directory','sourceDirectory','outputDirectory','originalNativeReport','sourceEnvelopeFile'])absolute(input[key],key);
absolute(input.bundle?.file,'BUNDLE');
need(Number.isSafeInteger(input.bundle.bytes)&&input.bundle.bytes>0&&/^[a-f0-9]{64}$/.test(input.bundle.sha256),'REVIEWED_BUNDLE_IDENTITY_REQUIRED');
need(Number.isSafeInteger(input.manifest.bytes)&&/^[a-f0-9]{64}$/.test(input.manifest.sha256),'ORIGINAL_MANIFEST_IDENTITY_REQUIRED');
const output=input.outputDirectory,stateFile=join(output,'receiving-state.json');
await mkdir(output,{recursive:true,mode:0o700});
const pathIn=(root,name)=>{
 need(typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.includes('\0'),'ORDINARY_MEMBER_PATH_REQUIRED');
 const path=resolve(root,name),rel=relative(root,path);
 need(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+'/'),'MEMBER_OUTSIDE_SELECTED_DIRECTORY');
 return path;
};
async function fingerprint(file){
 const info=await lstat(file);need(info.isFile()&&!info.isSymbolicLink(),'ORIGINAL_ORDINARY_FILE_REQUIRED');
 const hash=createHash('sha256');let bytes=0;
 for await(const block of createReadStream(file)){hash.update(block);bytes+=block.length;}
 const again=await lstat(file);
 need(info.dev===again.dev&&info.ino===again.ino&&info.size===again.size&&info.mtimeMs===again.mtimeMs,'FILE_CHANGED_DURING_READ');
 return {bytes,sha256:hash.digest('hex')};
}
async function immutable(file,bytes){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 const temp=file+'.'+randomUUID()+'.tmp',handle=await open(temp,'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 try{await link(temp,file);}
 catch(error){if(error.code!=='EEXIST')throw error;
  same(await fingerprint(file),{bytes:bytes.length,sha256:sha(bytes)},'RETAINED_FILE_CONFLICT');}
 finally{await unlink(temp);}
 return {file,...await fingerprint(file)};
}
async function saveJson(file,value){
 const temp=file+'.'+randomUUID()+'.tmp',handle=await open(temp,'wx',0o600);
 try{await handle.writeFile(jsonBytes(value));await handle.sync();}finally{await handle.close();}
 await rename(temp,file);
}
await immutable(join(output,'receiving-input.json'),inputBytes);
let report;
try{report=JSON.parse(await readFile(stateFile,'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;}
if(report)need(report.operationId===input.operationId&&report.stageId===input.stageId&&
 report.inputSha256===sha(inputBytes),'ORIGINAL_RECEIVING_STATE_CHANGED');
else report={schema:'sf88.research-client.source-bundle-receiving-result.v1',operationId:input.operationId,
 stageId:input.stageId,inputSha256:sha(inputBytes),dossierId:input.dossierId,questionId:input.questionId,
 sourceCommit:input.sourceCommit,startedAt:now(),state:'prepared',attempts:[],stages:{},artifacts:{}};
const save=()=>saveJson(stateFile,report);
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const artifact=async(name,work)=>{
 const retained=report.artifacts[name];
 if(retained){same(await fingerprint(retained.file),{bytes:retained.bytes,sha256:retained.sha256},'RETAINED_OUTPUT_CHANGED');return retained;}
 const made=await work();report.artifacts[name]=made;await save();return made;
};
const writeArtifact=(name,path,bytes)=>artifact(name,()=>immutable(path,bytes));
async function streamArtifact(name,path,body){
 return artifact(name,async()=>{
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=path+'.'+randomUUID()+'.tmp',handle=await open(temp,'wx',0o600);
  const hash=createHash('sha256');let bytes=0;
  try{for await(const chunk of body){const block=Buffer.from(chunk);hash.update(block);bytes+=block.length;await handle.writeFile(block);}await handle.sync();}
  finally{await handle.close();}
  // This operation owns the output path. A prior complete but unrecorded stream
  // is retained under its own filename before the new observed export is placed.
  try{await lstat(path);await rename(path,path+'.unrecorded-'+randomUUID());}catch(error){if(error.code!=='ENOENT')throw error;}
  await rename(temp,path);
  return {file:path,bytes,sha256:hash.digest('hex')};
 });
}
const stage=async(name,work)=>{
 report.currentStage=name;report.state='running';await save();
 try{const result=await work();report.stages[name]={state:'complete',at:now(),result};await save();emit({stage:name,state:'complete'});return result;}
 catch(error){report.stages[name]={state:'attention',at:now(),error:{code:error.code??error.name,message:error.message}};await save();throw error;}
};
try{
 if(report.state==='complete'){
  for(const item of Object.values(report.artifacts))same(await fingerprint(item.file),{bytes:item.bytes,sha256:item.sha256},'COMPLETED_RECEIVING_ARTIFACT_CHANGED');
  emit({state:'complete',operationId:input.operationId,stageId:input.stageId,report:stateFile,
   revision:report.selectedRevision,editionId:report.editionId,reused:true});process.exit(0);
 }
 report.attempts.push({at:now(),pid:process.pid,node:process.version});await save();
 const originalRaw=await readFile(input.originalNativeReport),original=JSON.parse(originalRaw);
 need(original.schema==='sf88.research-client.original-native-result.v1'&&original.state==='complete'&&
  original.operationId===input.operationId&&original.dossierId===input.dossierId&&original.questionId===input.questionId,
  'COMPLETE_ORIGINAL_NATIVE_CASE_REQUIRED');
 const originalStages=['original-listener','original-attachment','original-paged-review','same-crossref-operation',
  'source-grounded-question-note','complete-original-delivery','encoding-preserving-receiving','attachment-return'];
 need(originalStages.every(key=>original.steps[key]?.state==='complete'),'ORIGINAL_NATIVE_JOURNEY_INCOMPLETE');
 await writeArtifact('original-native-report',join(output,'original-native-report.json'),originalRaw);
 report.originalNative={sourceMerge:original.sourceMerge,finalRevision:original.finalRevision,endedAt:original.endedAt,
  bytes:originalRaw.length,sha256:sha(originalRaw)};await save();

 const envelopeRaw=await readFile(input.sourceEnvelopeFile),envelope=JSON.parse(envelopeRaw);
 same({bytes:envelopeRaw.length,sha256:sha(envelopeRaw)},{bytes:input.sourceEnvelope.bytes,sha256:input.sourceEnvelope.sha256},'CURRENT_SOURCE_ENVELOPE_CHANGED');
 need(envelope.schema==='commons.research-ottawa-import-runtime-source.v1'&&envelope.ref===input.sourceCommit&&
  envelope.repository==='woahwhattheheck/public-commons-sprint-2026'&&Array.isArray(envelope.files)&&envelope.files.length>0,
  'CURRENT_COMPLETE_RESEARCH_CORE_REQUIRED');
 const paths=new Set();
 for(const file of envelope.files){
  need(!paths.has(file.path),'DUPLICATE_SOURCE_PATH');paths.add(file.path);
  same(await fingerprint(pathIn(input.sourceDirectory,file.path)),{bytes:file.bytes,sha256:file.sha256},'RESEARCH_CORE_SOURCE_CHANGED');
 }
 await writeArtifact('current-source-manifest',join(output,'current-source-manifest.json'),jsonBytes({
  schema:'sf88.research-client.selected-source-manifest.v1',repository:envelope.repository,ref:envelope.ref,
  envelope:{bytes:envelopeRaw.length,sha256:sha(envelopeRaw),gitBlob:input.sourceEnvelope.gitBlob},
  files:envelope.files.map(({content,...metadata})=>metadata)}));
 const core=join(input.sourceDirectory,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers');
 const {openDossierStore}=await import(pathToFileURL(join(core,'dossier.mjs')));
 const {inspectSourceBundle,sourceBundleFileBytes}=await import(pathToFileURL(join(core,'source-bundles.mjs')));
 const raw=await readFile(input.bundle.file);
 same({bytes:raw.length,sha256:sha(raw)},{bytes:input.bundle.bytes,sha256:input.bundle.sha256},'REVIEWED_BUNDLE_CHANGED');
 const prepared=inspectSourceBundle(raw);
 same(prepared.manifest,input.review.manifest,'REVIEWED_MANIFEST_CHANGED');
 need(prepared.value.manifestOriginal,'ORIGINAL_MANIFEST_BYTES_REQUIRED');
 const manifestRaw=sourceBundleFileBytes(prepared.value.manifestOriginal);
 same({bytes:manifestRaw.length,sha256:sha(manifestRaw)},input.manifest,'ORIGINAL_MANIFEST_CHANGED');
 same(prepared.manifest.sources.map(row=>row.key),input.review.sourceKeys,'REVIEWED_SOURCE_GROUPS_CHANGED');
 same((prepared.manifest.findings??[]).map(row=>row.key),input.review.findingKeys,'REVIEWED_FINDINGS_CHANGED');
 need(prepared.preview.fileCount===input.review.fileCount&&prepared.preview.fileBytes===input.review.fileBytes,
  'REVIEWED_FILE_INVENTORY_CHANGED');
 const store=await openDossierStore(input.directory,{providers:{}});
 const checkQuestion=metadata=>{
  need(metadata.id===input.dossierId,'ORIGINAL_DOSSIER_CHANGED');
  const question=metadata.questions.find(row=>row.id===input.questionId);
  need(question?.text===input.questionText,'ORIGINAL_QUESTION_CHANGED');return question;
 };
 const findEdition=metadata=>metadata.editions.find(row=>row.questionId===input.questionId&&
  row.origin?.mode==='LOCAL_SOURCE_BUNDLE'&&row.raw?.sha256===input.bundle.sha256);
 const reviewedPreview=preview=>{
  same({...prepared.preview,dossierId:input.dossierId,questionId:input.questionId},
   Object.fromEntries(Object.entries(preview).filter(([key])=>!['expectedRevision','alreadyReceived','editionId'].includes(key))),
   'ORIGINAL_QUESTION_PREVIEW_CHANGED');
 };
 await stage('original-case-and-source-review',async()=>{
  const metadata=await store.getMetadata(input.dossierId);checkQuestion(metadata);
  need(metadata.revision>=original.finalRevision,'ORIGINAL_CASE_HISTORY_REGRESSED');
  const preview=await store.previewSourceBundle(input.dossierId,{questionId:input.questionId,rawBytes:raw});
  reviewedPreview(preview);
  const baseline=await store.getMetadata(input.dossierId,{revision:preview.expectedRevision});checkQuestion(baseline);
  if(!report.initialReview){report.initialReview={preview,metadata:baseline,
   revisions:await store.listRevisions(input.dossierId,{revision:baseline.revision})};await save();}
  return {revision:preview.expectedRevision,alreadyReceived:preview.alreadyReceived,
   fileCount:preview.fileCount,fileBytes:preview.fileBytes,sources:preview.sources.length,findings:preview.findings.length,
   bundleSha256:preview.bundleSha256};
 });
 await stage('atomic-original-receiving',async()=>{
  for(let attempt=0;attempt<5;attempt++){
   const preview=await store.previewSourceBundle(input.dossierId,{questionId:input.questionId,rawBytes:raw});
   reviewedPreview(preview);
   const before=await store.getMetadata(input.dossierId,{revision:preview.expectedRevision});checkQuestion(before);
   const operation={at:now(),preview,expectedBundleSha256:input.bundle.sha256,expectedRevision:preview.expectedRevision};
   report.receiveAttempts??=[];report.receiveAttempts.push(operation);await save();
   try{
    const received=await store.receiveSourceBundle(input.dossierId,{questionId:input.questionId,rawBytes:raw,
     expectedBundleSha256:input.bundle.sha256,expectedRevision:preview.expectedRevision,projection:'metadata'});
    need(Number.isSafeInteger(received.revision),'ORIGINAL_RECEIVING_METADATA_REQUIRED');checkQuestion(received);
    const edition=findEdition(received);need(edition,'RECEIVED_ORIGINAL_EDITION_ABSENT');
    operation.returnedRevision=received.revision;operation.editionId=edition.id;operation.returnedAt=now();
    report.editionId=edition.id;await save();
    return {reviewedRevision:preview.expectedRevision,alreadyReceivedAtPreview:preview.alreadyReceived,
     returnedRevision:received.revision,editionId:edition.id};
   }catch(error){
    operation.error={code:error.code??error.name,message:error.message};await save();
    // The original receiver reconciles the exact edition before its CAS check.
    // On an uncertain filesystem return, inspect that same original question.
    const observed=await store.getMetadata(input.dossierId),edition=findEdition(observed);
    if(edition){report.editionId=edition.id;operation.reconciledRevision=observed.revision;await save();
     return {reviewedRevision:preview.expectedRevision,returnedRevision:observed.revision,
      editionId:edition.id,reconciledAfterError:operation.error};}
    if(error.code!=='REVISION_CONFLICT')throw error;
   }
  }
  throw Object.assign(new Error('The original dossier continued changing during review; continue this same saved receiving stage.'),{code:'REVISION_CONFLICT'});
 });

 await stage('original-curation-and-introduced-findings',async()=>{
  const current=await store.getMetadata(input.dossierId);checkQuestion(current);
  const edition=findEdition(current);need(edition?.id===report.editionId,'RECEIVED_EDITION_ID_CHANGED');
  let low=1,high=current.revision;
  while(low<high){const middle=Math.floor((low+high)/2),metadata=await store.getMetadata(input.dossierId,{revision:middle});
   if(metadata.editions.some(row=>row.id===edition.id))high=middle;else low=middle+1;}
  need(low>1,'SOURCE_BUNDLE_REQUIRES_EXISTING_CASE');
  const introduced=await store.getMetadata(input.dossierId,{revision:low});
  const before=await store.getMetadata(input.dossierId,{revision:low-1}),originalEdition=findEdition(introduced);
  checkQuestion(introduced);checkQuestion(before);
  same(introduced.questions,before.questions,'IMPORT_CHANGED_EXISTING_QUESTIONS');
  same(introduced.editions.filter(row=>row.id!==edition.id),before.editions,'IMPORT_CHANGED_EXISTING_EDITIONS');
  same(introduced.selections.filter(row=>row.editionId!==edition.id),before.selections,'IMPORT_CHANGED_EXISTING_SELECTIONS');
  const origin=originalEdition.origin;
  same(origin.sourceKeys,prepared.manifest.sources.map(row=>row.key),'IMPORTED_SOURCE_KEYS_CHANGED');
  need(origin.fileCount===prepared.preview.fileCount&&origin.fileBytes===prepared.preview.fileBytes&&
   originalEdition.raw.sha256===input.bundle.sha256&&originalEdition.raw.bytes===input.bundle.bytes,
   'IMPORTED_ORIGINAL_SOURCE_IDENTITY_CHANGED');
  same(originalEdition.sourceTerms,prepared.manifest.sourceTerms,'IMPORTED_SOURCE_TERMS_CHANGED');
  need(Array.isArray(origin.findingIds)&&origin.findingIds.length===prepared.manifest.findings.length,'IMPORTED_FINDINGS_INCOMPLETE');
  const ids=new Set(origin.findingIds.map(row=>row.id));
  same(introduced.findings.filter(row=>!ids.has(row.id)),before.findings,'IMPORT_CHANGED_EXISTING_FINDINGS');
  const selections=introduced.selections.filter(row=>row.editionId===edition.id),occurrences=new Map();
  need(selections.length===prepared.manifest.sources.length,'IMPORTED_SOURCE_SELECTIONS_INCOMPLETE');
  for(let index=0;index<prepared.manifest.sources.length;index++){
   const declared=prepared.manifest.sources[index],selection=selections.find(row=>row.key===String(index));
   need(selection&&selection.questionId===input.questionId,'ORIGINAL_SOURCE_OCCURRENCE_ABSENT');
   same({selected:selection.selected,note:selection.note,classification:selection.classification},
    {selected:declared.selected??true,note:declared.note??'',classification:declared.classification??'supports'},
    'REVIEWED_SOURCE_SELECTION_CHANGED');
   occurrences.set(declared.key,selection.occurrenceId);
  }
  for(const expected of prepared.manifest.findings){
   const id=origin.findingIds.find(row=>row.key===expected.key)?.id,finding=introduced.findings.find(row=>row.id===id);
   need(finding&&finding.questionId===input.questionId,'REVIEWED_FINDING_ABSENT');
   same({title:finding.title,text:finding.text,occurrenceIds:finding.occurrenceIds},
    {title:expected.title,text:expected.text,occurrenceIds:expected.sourceKeys.map(key=>occurrences.get(key))},
    'REVIEWED_FINDING_TEXT_OR_SOURCES_CHANGED');
  }
  for(const key of ['citationReviewCount','eligibilityReviewCount','extractionFormCount','extractionPublicationCount'])
   same(introduced[key],before[key],'IMPORT_CHANGED_EXISTING_REVIEW_MODEL');
  const prefix=await store.listRevisions(input.dossierId,{revision:report.initialReview.metadata.revision});
  same(prefix,report.initialReview.revisions,'ORIGINAL_REVISION_HISTORY_CHANGED');
  report.introductionRevision=low;
  report.selectedRevision??=current.revision;
  const selected=await store.getMetadata(input.dossierId,{revision:report.selectedRevision});
  const revisions=await store.listRevisions(input.dossierId,{revision:report.selectedRevision});
  await writeArtifact('received-metadata',join(output,'received-metadata.json'),jsonBytes(selected));
  await writeArtifact('original-revisions',join(output,'original-revisions.json'),jsonBytes(revisions));
  await writeArtifact('introduced-findings',join(output,'introduced-findings.json'),jsonBytes({
   dossierId:input.dossierId,questionId:input.questionId,introductionRevision:low,editionId:edition.id,
   sourceSelections:selections,findings:introduced.findings.filter(row=>ids.has(row.id))}));
  return {introductionRevision:low,selectedRevision:report.selectedRevision,editionId:edition.id,
   originalQuestions:before.questions.length,preservedEditions:before.editions.length,
   preservedSelections:before.selections.length,preservedFindings:before.findings.length,
   receivedSelections:selections.length,receivedFindings:ids.size,retainedHistory:revisions.length};
 });

 await stage('complete-original-files-and-readable-reports',async()=>{
  const retained=await store.readRetainedEdition(input.dossierId,report.editionId,{revision:report.selectedRevision});
  same({bytes:retained.bytes.length,sha256:sha(retained.bytes)},{bytes:input.bundle.bytes,sha256:input.bundle.sha256},'RETAINED_ORIGINAL_BUNDLE_CHANGED');
  await writeArtifact('original-source-bundle',join(output,'Ottawa_EAHE_Research_Sources_20261012.json'),retained.bytes);
  await writeArtifact('original-source-manifest',join(output,'ottawa-source-manifest.json'),manifestRaw);
  const originalFiles=join(output,'original-study');
  const files=[];
  for(const file of prepared.value.files){
   const bytes=sourceBundleFileBytes(file),entry=await writeArtifact('original-member:'+file.name,
    pathIn(originalFiles,file.name),bytes);
   files.push({name:file.name,mediaType:file.mediaType??'application/octet-stream',...entry});
  }
  same(files.reduce((sum,file)=>sum+file.bytes,0),prepared.preview.fileBytes,'ORIGINAL_FILE_BYTES_CHANGED');
  await writeArtifact('original-member-inventory',join(output,'original-member-inventory.json'),jsonBytes(files));
  for(const format of ['html','md']){
   if(report.artifacts['research-report-'+format]){await artifact('research-report-'+format,()=>{throw new Error('unreachable');});continue;}
   const exported=await store.exportDossier(input.dossierId,{format,revision:report.selectedRevision});
   need(exported.revision===report.selectedRevision,'REPORT_REVISION_CHANGED');
   const bytes=Buffer.from(exported.body);
   await writeArtifact('research-report-'+format,join(output,'NCC_Greenhouse_Research_Report.'+format),bytes);
  }
  const html=await readFile(report.artifacts['research-report-html'].file,'utf8');
  const selected=await store.getMetadata(input.dossierId,{revision:report.selectedRevision});
  const selectedMembers=new Set(selected.selections.filter(row=>row.editionId===report.editionId&&row.selected).map(row=>row.key));
  const expectedReportFiles=new Set(prepared.manifest.sources.flatMap((row,index)=>selectedMembers.has(String(index))?row.files:[]));
  for(const file of prepared.value.files)if(expectedReportFiles.has(file.name)){
   const original=sourceBundleFileBytes(file);
   need(html.includes('data:application/octet-stream;base64,'+original.toString('base64')),
    'READABLE_REPORT_ORIGINAL_FILE_DOWNLOAD_ABSENT');
  }
  return {revision:report.selectedRevision,fileCount:files.length,fileBytes:prepared.preview.fileBytes,
   reports:['research-report-html','research-report-md'].map(key=>report.artifacts[key]),
   originalDownloadsInReport:expectedReportFiles.size,sourceTerms:prepared.manifest.sourceTerms};
 });

 await stage('complete-portable-and-independent-reopen',async()=>{
  let portable=report.artifacts['research-portable'];
  if(portable)portable=await artifact('research-portable',()=>{throw new Error('unreachable');});
  else{
   const exported=await store.exportStream(input.dossierId,{compression:'gzip',revision:report.selectedRevision});
   need(exported.revision===report.selectedRevision,'PORTABLE_REVISION_CHANGED');
   portable=await streamArtifact('research-portable',join(output,'NCC_Greenhouse_Research_Dossier.research.json.gz'),exported.body);
  }
  const receiverDirectory=join(output,'portable-receiver');
  const receiver=await openDossierStore(receiverDirectory,{providers:{}});
  const reopened=await receiver.reopenStream(createReadStream(portable.file),{projection:'metadata'});
  need(reopened.id===input.dossierId&&reopened.revision===report.selectedRevision,'ORIGINAL_PORTABLE_REOPEN_CHANGED');
  const expected=await store.getMetadata(input.dossierId,{revision:report.selectedRevision});
  same(reopened,expected,'PORTABLE_CURATED_CASE_CHANGED');
  same(await receiver.listRevisions(input.dossierId),await store.listRevisions(input.dossierId,{revision:report.selectedRevision}),
   'PORTABLE_ORIGINAL_HISTORY_CHANGED');
  const received=await receiver.readRetainedEdition(input.dossierId,report.editionId);
  same({bytes:received.bytes.length,sha256:sha(received.bytes)},{bytes:input.bundle.bytes,sha256:input.bundle.sha256},'PORTABLE_ORIGINAL_BUNDLE_CHANGED');
  const rechecked=inspectSourceBundle(received.bytes);
  same(rechecked.preview,prepared.preview,'PORTABLE_REVIEWED_SOURCE_CHANGED');
  return {directory:receiverDirectory,id:reopened.id,revision:reopened.revision,
   editions:reopened.editions.length,selections:reopened.selections.length,findings:reopened.findings.length,
   sourceBundleSha256:sha(received.bytes),portable:{bytes:portable.bytes,sha256:portable.sha256}};
 });
 report.state='complete';report.endedAt=now();delete report.currentStage;
 report.resourceUsage={node:process.version,platform:process.platform,arch:process.arch,...process.resourceUsage()};
 await save();
 emit({state:'complete',operationId:input.operationId,stageId:input.stageId,report:stateFile,
  revision:report.selectedRevision,introductionRevision:report.introductionRevision,editionId:report.editionId,
  originalFiles:prepared.preview.fileCount,reviewedFindings:prepared.manifest.findings.length});
}catch(error){
 report.state='attention';report.error={code:error.code??error.name,message:error.message};
 report.lastReturnAt=now();await save();
 process.stderr.write(JSON.stringify({state:'attention',operationId:input.operationId,stageId:input.stageId,
  stage:report.currentStage,error:report.error})+'\n');process.exitCode=1;
}
