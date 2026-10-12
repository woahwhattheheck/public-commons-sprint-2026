// MIT. Original source-bound BCG publication for the existing Research synthesis programme.
import {readFile,writeFile,mkdir,rename,open,stat,lstat,unlink} from 'node:fs/promises';
import {resolve,join,isAbsolute,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';

const SOURCE_FILES=[
  {
    "path": "original/dat.bcg.txt",
    "bytes": 1036,
    "sha256": "2dde71166d1ccdf9567ef330a5886b3faa51e8f42aa08fec2cd51a0085644a74",
    "gitBlob": "72433a53b1e15cd547a585a5a47423ec129b0fdb"
  },
  {
    "path": "original/dat.bcg.r",
    "bytes": 694,
    "sha256": "693531171f992228fef41ceee428d91192c0f84d3ac2aa03fe9666afc33144e5",
    "gitBlob": "2813570ffdc23cf0c56a8560ef5da82bfdfe6bab"
  },
  {
    "path": "original/dat.bcg.Rd",
    "bytes": 4223,
    "sha256": "981c4adc48f6f85b2cbec8441e77fdcabc5fffe8a128930e87962c8bc4ff8823",
    "gitBlob": "db5d758100bb4210f0efa1fc84d05a30f5695bc0"
  },
  {
    "path": "original/metadat-DESCRIPTION",
    "bytes": 1767,
    "sha256": "b9088c18bdb39979021b8a3f9da11f54229c6a7a70b4508fd0737309472452a9",
    "gitBlob": "fddd8bb84fc87037327aefb59da067875fb60bfd"
  },
  {
    "path": "bcg-source-rows.json",
    "bytes": 37801,
    "sha256": "61495fa362f46fca387d7174b1e1268395f2331063fd6fbe838ae7d3c63453d2",
    "gitBlob": "8f4fd083b8801128108a8997d7d74234ff6adfd5"
  },
  {
    "path": "reference-protocol.json",
    "bytes": 3629,
    "sha256": "6a2ef0cbaf5ddd6032e78fa6a460a4f6daa91da96ff9ae747bdc4a84dfef1cf4",
    "gitBlob": "0170132ca8bef9f9425a4205fb2d9ccf0251d700"
  },
  {
    "path": "README.md",
    "bytes": 9951,
    "sha256": "8ece5f54159d6f7843eb77b9c2d422f3a7258d3ff165b9552f0a9a7ac56b5f36",
    "gitBlob": "28b8ee1c1f590408fcee2488cc95789802ef58a1"
  },
  {
    "path": "original/viechtbauer-2010-metafor.pdf",
    "bytes": 518660,
    "sha256": "b883a5a6c8cc358b5a367ddbfb94649b9cc2438044c6fac54dde08b1c8be3978",
    "gitBlob": "356eb0690f86fa581267c520c0b06c92f0cc6a65"
  },
  {
    "path": "sources.json",
    "bytes": 14300,
    "sha256": "ea9e178ac97f6f01cb1d0033f3403f03f218209efa2f4a5376134a72a7476e48",
    "gitBlob": "3f71f4176af02066c7ef230271efd744271b5c7c"
  }
];
const REFERENCE_REVISION='d1a595bc71f1653e5563f608e148111e7751db1c';
const PREFIX='stellar/scf-starforge-20261009/sf88-operator-buyer-cli';
const ACTOR={id:'d7ca-bcg-reference-operator',name:'Commons BCG source reference operator'};
const QUESTION='Published BCG methods reference: vaccinated versus control TB events in the thirteen original metadat studies';
const REASON='The published thirteen-study source table and its original lexical quantities are selected for this explicitly labelled methods reference.';
const FIELDS=['trial','author','year','tpos','tneg','cpos','cneg','ablat','alloc'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>sha(Buffer.from(JSON.stringify(canonical(value))));
const clone=value=>structuredClone(value);
const need=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const requestId=(operation,label)=>'bcg_'+digest({operation,label}).slice(0,64);
async function readJson(file){return JSON.parse(await readFile(file,'utf8'));}
async function optionalJson(file){try{return await readJson(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDirectory(path){
 need(isAbsolute(path),'BCG_ABSOLUTE_DIRECTORY_REQUIRED');
 await mkdir(path,{recursive:true,mode:0o700});
 const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink(),'BCG_OWNED_DIRECTORY_REQUIRED');
 return path;
}
async function replaceJson(file,value){
 const temporary=file+'.'+randomUUID()+'.partial';
 const fd=await open(temporary,'wx',0o600);
 try{await fd.writeFile(jsonBytes(value));await fd.sync();}finally{await fd.close();}
 try{await rename(temporary,file);const parent=await open(dirname(file),'r');try{await parent.sync();}finally{await parent.close();}}
 catch(error){try{await unlink(temporary);}catch{}throw error;}
}
async function retain(file,bytes){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}
 catch(error){if(error.code!=='EEXIST')throw error;need((await readFile(file)).equals(bytes),'BCG_RETAINED_OUTPUT_CHANGED');}
 const received=await readFile(file);need(received.equals(bytes),'BCG_OUTPUT_READBACK_CHANGED');
 return {path:file,bytes:received.length,sha256:sha(received)};
}
function fieldDefinition(id){
 return {id,label:({tpos:'Vaccinated TB events',tneg:'Vaccinated non-events',cpos:'Control TB events',
 cneg:'Control non-events',ablat:'Absolute latitude',alloc:'Reported allocation',trial:'Original trial number',
 author:'Original source author label',year:'Original source year',vaccinated_total:'Vaccinated total',
 control_total:'Control total',followup_duration:'Reported individual follow-up duration',
 risk_of_bias:'Independent design-specific risk-of-bias appraisal'})[id]??id,
 valueType:['author','alloc','followup_duration','risk_of_bias'].includes(id)?'text':'integer',
 required:true,instructions:'Preserve the original tagged value and exact source basis. Derived totals name their original inputs.'};
}
function originalAnswers(row,index,occurrenceId){
 const rowId=row.referenceStudyId;
 const base=field=>({occurrenceId,kind:'json-pointer',fileName:'bcg-source-rows.json',pointer:'/rows/'+index+'/reported/'+field});
 const passage=field=>({occurrenceId,kind:'passage',fileName:'original/dat.bcg.txt',
 locator:'Line '+row.sourceBinding.line+', column '+field+', bytes '+row.sourceBinding.fields[field].byteStart+
 ' through '+row.sourceBinding.fields[field].byteEndExclusive+' exclusive',
 quote:row.tokens[field]});
 const answers=FIELDS.map(field=>({rowId,fieldId:field,status:'reported',value:['str',row.reported[field]],
 bases:[base(field),passage(field)],context:{referenceStudyId:rowId,originalColumn:field},
 note:'Exact original source token: '+row.tokens[field]}));
 for(const [field,left,right,derived] of [
 ['vaccinated_total','tpos','tneg',row.derivedForReview.vaccinatedTotal],
 ['control_total','cpos','cneg',row.derivedForReview.controlTotal]]){
  need(String(BigInt(row.reported[left])+BigInt(row.reported[right]))===derived.value,'BCG_DERIVED_TOTAL_CHANGED');
  answers.push({rowId,fieldId:field,status:'derived',value:['str',derived.value],bases:[base(left),base(right)],
   context:{referenceStudyId:rowId},note:'Exact integer sum of the two original counts.',
   derivation:{method:'Exact integer addition',inputFieldIds:[left,right],expression:left+'+'+right,
    reference:'original/dat.bcg.txt line '+row.sourceBinding.line}});
 }
 answers.push(
 {rowId,fieldId:'followup_duration',status:'not-reported',value:['NoneType',null],bases:[],
  note:'The retained source table does not report an individual trial follow-up duration. The protocol selects the original trial-defined observation without imputing a duration.'},
 {rowId,fieldId:'risk_of_bias',status:'not-reported',value:['NoneType',null],bases:[],
  note:'The retained source reports allocation labels, which are preserved separately. Independent design-specific appraisal is not contained in this published reference dataset.'}
 );
 return answers;
}

export async function publishBcgReference({sourceRoot,referenceDirectory,dossierDirectory,outputDirectory,
 operationId='SCF-RESEARCH-EVIDENCE-SYNTHESIS-20261012-BCG-PUBLICATION',python='python3',signal}={}){
 for(const value of [sourceRoot,referenceDirectory,dossierDirectory,outputDirectory])
  need(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0'),'BCG_ABSOLUTE_SELECTION_REQUIRED');
 need(typeof operationId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(operationId),'BCG_ORIGINAL_OPERATION_REQUIRED');
 const abort=()=>{if(signal?.aborted)throw signal.reason??Object.assign(new Error('BCG_ORIGINAL_OPERATION_ABORTED'),{code:'ABORT_ERR'});};
 abort();sourceRoot=resolve(sourceRoot);referenceDirectory=resolve(referenceDirectory);
 dossierDirectory=await privateDirectory(resolve(dossierDirectory));outputDirectory=await privateDirectory(resolve(outputDirectory));
 const selectedFiles=new Map();
 for(const descriptor of SOURCE_FILES){
  abort();const bytes=await readFile(join(referenceDirectory,descriptor.path));
  need(bytes.length===descriptor.bytes&&sha(bytes)===descriptor.sha256,'BCG_ORIGINAL_REFERENCE_FILE_CHANGED');
  need(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')===descriptor.gitBlob,
   'BCG_ORIGINAL_REFERENCE_GIT_BYTES_CHANGED');
  selectedFiles.set(descriptor.path,bytes);
 }
 const projection=JSON.parse(selectedFiles.get('bcg-source-rows.json').toString('utf8'));
 need(projection.rows.length===13&&new Set(projection.rows.map(row=>row.referenceStudyId)).size===13,
  'BCG_THIRTEEN_DISTINCT_SOURCE_STUDIES_REQUIRED');
 const raw=selectedFiles.get('original/dat.bcg.txt');
 for(const row of projection.rows)for(const field of FIELDS){
  const source=row.sourceBinding.fields[field];
  need(raw.subarray(source.byteStart,source.byteEndExclusive).toString('utf8')===source.sourceToken&&
   source.sourceToken===row.tokens[field],'BCG_ORIGINAL_LEXICAL_RANGE_CHANGED');
 }
 need(JSON.stringify(projection.allocationSubgroups.random)===JSON.stringify([1,2,3,4,7,8,9].map(n=>'metadat-bcg-trial-'+n)),
  'BCG_ORIGINAL_RANDOM_ALLOCATION_SELECTION_CHANGED');
 const base=join(sourceRoot,PREFIX,'research-dossiers');
 const moduleSources=[];
 for(const file of ['dossier.mjs','source-bundles.mjs','eligibility-review.mjs','study-extraction.mjs',
 'research-source-values.mjs','extraction-publication.mjs','extraction-publication-contracts.mjs','extraction-publication-render.mjs']){
  const bytes=await readFile(join(base,file));moduleSources.push({path:join(base,file),bytes:bytes.length,sha256:sha(bytes)});
 }
 const [{openDossierStore},{createSourceBundle}]=await Promise.all([
  import(pathToFileURL(join(base,'dossier.mjs')).href),import(pathToFileURL(join(base,'source-bundles.mjs')).href)]);
 const binding={operationId,sourceRoot,referenceDirectory,dossierDirectory,outputDirectory,
  referenceRevision:REFERENCE_REVISION,sourceFiles:SOURCE_FILES,modules:moduleSources};
 const journalFile=join(outputDirectory,'bcg-publication-operation.json');
 let journal=await optionalJson(journalFile);
 if(journal)need(journal.schema==='commons.bcg-original-publication-operation/v1'&&digest(journal.binding)===digest(binding),
  'BCG_ORIGINAL_OPERATION_SELECTION_CHANGED');
 else{journal={schema:'commons.bcg-original-publication-operation/v1',binding,startedAt:new Date().toISOString(),
  dossierId:null,questionId:null,stages:{},outputs:[],complete:null};await replaceJson(journalFile,journal);}
 const save=()=>replaceJson(journalFile,journal);
 const store=await openDossierStore(dossierDirectory,{extractionOptions:{python,signal}});
 const title='Published BCG methods example — thirteen original studies';
 const description=REASON+'\nOriginal operation: '+operationId+'\nSource alias dat.colditz1994 refers to this same cohort.';
 if(!journal.dossierId){
  const matches=(await store.list()).filter(value=>value.title===title&&value.description===description);
  need(matches.length<=1,'BCG_ORIGINAL_DOSSIER_AMBIGUOUS');
  const dossier=matches[0]??await store.create({title,description,projection:'metadata'});
  journal.dossierId=dossier.id;await save();
 }
 let metadata=await store.getMetadata(journal.dossierId);
 if(!journal.questionId){
  const questions=metadata.questions.filter(value=>value.text===QUESTION);need(questions.length<=1,'BCG_ORIGINAL_QUESTION_AMBIGUOUS');
  if(!questions.length)metadata=await store.addQuestion(metadata.id,{text:QUESTION,expectedRevision:metadata.revision,projection:'metadata'});
  journal.questionId=metadata.questions.find(value=>value.text===QUESTION).id;await save();
 }
 const dossierId=journal.dossierId,questionId=journal.questionId;
 async function mutate(label,method,action,data,actor=ACTOR,reviewId){
  abort();let entry=journal.stages[label];
  if(!entry){
   const current=await store.getMetadata(dossierId);
   entry={method,request:{requestId:requestId(operationId,label),expectedRevision:current.revision,actor:clone(actor),
    action,...(reviewId===undefined?{}:{reviewId}),data:clone(data)},status:'PREPARED'};journal.stages[label]=entry;await save();
  }
  need(entry.method===method&&entry.request.action===action&&digest(entry.request.data)===digest(data)&&
   digest(entry.request.actor)===digest(actor)&&entry.request.reviewId===reviewId,'BCG_ORIGINAL_REQUEST_CHANGED');
  if(!entry.response){
   try{
    const response=await store[method](dossierId,{...clone(entry.request),projection:'metadata'});
    need(response.operation.requestId===entry.request.requestId,'BCG_ORIGINAL_RESPONSE_CHANGED');
    entry.response=clone(response);entry.status='SAVED';entry.completedAt=new Date().toISOString();await save();
   }catch(error){entry.lastError={code:error.code??'BCG_NATIVE_ERROR',message:String(error.message??error),at:new Date().toISOString()};
    await save();throw error;}
  }
  return clone(entry.response.operation.result);
 }

 const manifest={
  schema:'sf88-research-source-manifest-v1',
  label:'BCG published methods reference — thirteen original study rows',
  description:REASON,
  sourceTerms:'Original metadat data/code and their GPL (>=2) declaration are retained unchanged in the selected files. The Viechtbauer (2010) Journal of Statistical Software article is retained with Creative Commons Attribution provenance. Complete source, attribution and retrieval identities are in sources.json and original/metadat-DESCRIPTION.',
  sourceReference:'BCG reference source '+REFERENCE_REVISION+'; complete nine-file input',
  sources:projection.rows.map(row=>({
   key:row.referenceStudyId,title:row.reported.author+' ('+row.reported.year+'), original BCG trial '+row.reported.trial,
   url:'https://github.com/wviechtb/metadat/blob/master/data-raw/dat.bcg.txt#L'+row.sourceBinding.line,
   summary:'Original published reference-table row '+row.reported.trial+'. Allocation: '+row.reported.alloc+
    '. Retained trial-defined TB event/non-event counts; individual follow-up duration is unreported.',
   note:'The complete original dataset and methodological article are shared retained context. This occurrence identifies this original dataset row.',
   metadata:{referenceStudyId:row.referenceStudyId,reported:clone(row.reported),tokens:clone(row.tokens),
    originalSourceBinding:clone(row.sourceBinding),derivedForReview:clone(row.derivedForReview),
    sourceRole:'PUBLISHED_METHODS_REFERENCE_ROW',aliasOfSameCohort:projection.aliasOfThisSameDataset},
   selected:true,classification:'supports',files:SOURCE_FILES.map(file=>file.path)
  })),
  findings:[{key:'complete-reference-cohort',title:'One published thirteen-study reference cohort',
   text:'The full original dataset has thirteen distinct trial rows. dat.colditz1994 aliases the same source bytes. The random-allocation sensitivity selects original trials 1,2,3,4,7,8,9. Durations and independent risk-of-bias judgments remain unreported.',
   sourceKeys:projection.rows.map(row=>row.referenceStudyId)}]
 };
 const bundle=createSourceBundle({manifestBytes:jsonBytes(manifest),files:selectedFiles,manifestName:'bcg-source-manifest.json'});
 const sourceBundleFile=await retain(join(outputDirectory,'bcg-original-source-bundle.json'),bundle.bytes);
 let sourceStage=journal.stages['receive-original-sources'];
 if(!sourceStage){
  const preview=await store.previewSourceBundle(dossierId,{questionId,rawBytes:bundle.bytes});
  sourceStage={method:'receiveSourceBundle',expectedRevision:preview.expectedRevision,expectedBundleSha256:preview.bundleSha256,
   preview:clone(preview),status:'PREPARED'};journal.stages['receive-original-sources']=sourceStage;await save();
 }
 need(sourceStage.expectedBundleSha256===sha(bundle.bytes),'BCG_ORIGINAL_SOURCE_BUNDLE_CHANGED');
 if(!sourceStage.response){
  abort();sourceStage.response=await store.receiveSourceBundle(dossierId,{questionId,rawBytes:bundle.bytes,
   expectedBundleSha256:sourceStage.expectedBundleSha256,expectedRevision:sourceStage.expectedRevision,projection:'metadata'});
  sourceStage.status='SAVED';await save();
 }
 metadata=await store.getMetadata(dossierId);
 const editions=metadata.editions.filter(value=>value.questionId===questionId&&
  value.origin?.mode==='LOCAL_SOURCE_BUNDLE'&&value.raw?.sha256===sourceStage.expectedBundleSha256);
 need(editions.length===1,'BCG_ONE_ORIGINAL_SOURCE_EDITION_REQUIRED');
 const sourceEdition=editions[0];
 need(JSON.stringify(sourceEdition.origin.sourceKeys)===JSON.stringify(projection.rows.map(row=>row.referenceStudyId)),
  'BCG_ORIGINAL_SOURCE_OCCURRENCE_ORDER_CHANGED');
 const occurrences=projection.rows.map((row,index)=>{
  const values=metadata.selections.filter(value=>value.editionId===sourceEdition.id&&value.questionId===questionId&&value.key===String(index));
  need(values.length===1&&values[0].selected,'BCG_ORIGINAL_SOURCE_SELECTION_CHANGED');return values[0].occurrenceId;
 });
 const bundleReceipt={file:sourceBundleFile,editionId:sourceEdition.id,sourceBundleSha256:sourceEdition.raw.sha256,
  receivedRevision:sourceStage.response.revision,sourceKeys:sourceEdition.origin.sourceKeys,occurrenceIds:occurrences,
  preview:sourceStage.preview};

 const criteria=[
 {id:'original-reference-row',name:'Original published BCG reference row',
  include:'Exactly one of the thirteen distinct trial rows in the retained original dat.bcg source bytes.',
  exclude:'An outside study or a duplicate dataset alias without a distinct original trial row.'},
 {id:'compatible-original-counts',name:'Original compatible vaccinated/control TB counts',
  include:'The row declares vaccinated and control TB event/non-event counts for the original source trial observation.',
  exclude:'Missing or changed original counts, an incompatible outcome, or an inferred observation period.'}
 ];
 const review=await mutate('original-source-review','reviewEligibility','create-review',{
  questionId,name:'Published BCG reference cohort selection',description:REASON,
  protocol:{name:'Original thirteen-study BCG methods-reference protocol',criteria,
   stages:[{id:'reference-source',name:'Retained reference-row selection',criterionIds:criteria.map(value=>value.id),
    reviewerIds:[ACTOR.id],minimumDecisions:1,requireFullText:false}],
   reviewers:[ACTOR],resolverIds:[ACTOR.id],exclusionReasons:[{id:'outside-reference',label:'Outside or duplicate original reference cohort'}],
   disagreementProcedure:'The reference operator checks original row identity and all declared quantities against retained bytes. Any unresolved source disagreement is kept for correction before inclusion or publication.'}});
 const reviewId=review.review.id;
 const workSet=await mutate('original-source-workset','reviewEligibility','create-workset',{
  protocolId:review.protocol.id,name:'All thirteen original reference rows',occurrenceIds:occurrences,reason:REASON},ACTOR,reviewId);
 const studies=[],eligibilitySelections=[];
 for(let index=0;index<projection.rows.length;index++){
  const row=projection.rows[index],occurrenceId=occurrences[index],prefix='trial-'+row.reported.trial;
  const locator='original/dat.bcg.txt line '+row.sourceBinding.line+'; bcg-source-rows.json /rows/'+index;
  const decision=await mutate(prefix+'-eligibility-decision','reviewEligibility','decide',{
   workSetId:workSet.workSet.id,occurrenceId,stageId:'reference-source',disposition:'include',
   criterionAnswers:criteria.map(value=>({criterionId:value.id,assessment:'meets',
    note:'Original trial '+row.reported.trial+' and its nine declared field tokens passed the exact source-range checks.'})),
   basis:{availability:'available',occurrenceIds:[occurrenceId],locator,
    note:'This original source occurrence represents one published reference-table row and retains the complete original dataset and methods context.'},
   reason:REASON},ACTOR,reviewId);
  const resolution=await mutate(prefix+'-eligibility-resolution','reviewEligibility','resolve',{
   workSetId:workSet.workSet.id,occurrenceId,stageId:'reference-source',mode:'consensus',
   disposition:'include',decisionIds:[decision.decision.id],reason:'Explicit completed source-reference decision with exact retained row identity.'},ACTOR,reviewId);
  eligibilitySelections.push({occurrenceId,resolutionId:resolution.resolution.id,classification:'supports',
   note:'Selected original BCG trial '+row.reported.trial+' for the complete published methods-reference cohort.'});
  const linked=await mutate(prefix+'-study-link','reviewEligibility','study-link',{
   name:row.reported.author+' ('+row.reported.year+'), original BCG trial '+row.reported.trial,
   occurrenceIds:[occurrenceId],reason:'This distinct original trial number identifies one study in the published table.',
   evidence:[{occurrenceId,locator,note:'The retained source gives trial '+row.reported.trial+', author '+row.reported.author+
    ', year '+row.reported.year+'. The exact source row and its lexical ranges establish this report occurrence; the dataset alias remains this same cohort.'}]},ACTOR,reviewId);
  studies.push(linked.study);
 }
 const applied=await mutate('original-reference-selection','reviewEligibility','apply-outcomes',{
  workSetId:workSet.workSet.id,outcomes:eligibilitySelections,reason:'Apply the completed original source-reference decisions to these thirteen exact question-bound occurrences.'},ACTOR,reviewId);
 need(applied.application.outcomes.length===13&&applied.application.outcomes.every(value=>value.after.selected===true),
  'BCG_NATIVE_ELIGIBILITY_SELECTION_CHANGED');

 const definition={fields:[...FIELDS,'vaccinated_total','control_total','followup_duration','risk_of_bias'].map(fieldDefinition),
  reviewers:[ACTOR],extractorIds:[ACTOR.id],resolverIds:[ACTOR.id],minimumExtractions:1,
  disagreementProcedure:'The named reference operator verifies every source file, lexical range and returned typed pointer, then resolves the completed source-bound submission. A differing original quantity stops this reference publication.'};
 const form=await mutate('original-reference-form','reviewExtraction','create-form',{
  questionId,name:'BCG published source quantities',description:REASON,definition,reason:REASON});
 const resultSets=[];
 for(let index=0;index<projection.rows.length;index++){
  abort();const row=projection.rows[index],study=studies[index],occurrenceId=occurrences[index];
  const prefix='trial-'+row.reported.trial;
  const set=await mutate(prefix+'-result','reviewExtraction','create-result-set',{
   formEditionId:form.formEdition.id,studyId:study.id,studyVersion:study.version,
   name:row.referenceStudyId,description:row.reported.author+' ('+row.reported.year+')',
   rows:[{id:row.referenceStudyId,label:row.reported.author+' ('+row.reported.year+')',
    context:{referenceStudyId:row.referenceStudyId,sourceTrial:row.reported.trial,
     originalSourceLine:row.sourceBinding.line,comparison:'BCG vaccinated versus control',
     outcome:'Reported TB events',timepoint:'Original source trial-defined follow-up; duration unreported'},
    occurrenceIds:[occurrenceId]}],reason:REASON});
  const draft=await mutate(prefix+'-source-extraction','reviewExtraction','save-extraction',{
   resultSetId:set.resultSet.id,answers:originalAnswers(row,index,occurrenceId),reason:REASON});
  const bound=draft.extraction.answers;
  for(const field of FIELDS){
   const answer=bound.find(value=>value.fieldId===field);
   need(answer&&JSON.stringify(answer.value)===JSON.stringify(['str',row.reported[field]])&&
    answer.bases.some(basis=>basis.kind==='json-pointer'&&basis.found&&basis.file?.name==='bcg-source-rows.json'&&
     JSON.stringify(basis.typedValue)===JSON.stringify(answer.value))&&answer.sourceDifferences.length===0,
    'BCG_NATIVE_SOURCE_POINTER_VALUE_CHANGED');
  }
  const submitted=await mutate(prefix+'-submit','reviewExtraction','submit-extraction',{
   extractionId:draft.extraction.id,reason:'The complete original typed-source answers and exact integer derivations were reviewed.'});
  const resolved=await mutate(prefix+'-resolve','reviewExtraction','resolve-result',{
   resultSetId:set.resultSet.id,rowId:row.referenceStudyId,submissionIds:[submitted.submission.id],mode:'consensus',
   reason:'Explicit consensus on the complete source-bound reference submission; all original quantities match their retained source pointers.'});
  resultSets.push({referenceStudyId:row.referenceStudyId,studyId:study.id,studyVersion:study.version,
   occurrenceId,resultSetId:set.resultSet.id,submissionId:submitted.submission.id,resolutionId:resolved.resolution.id});
 }
 const table=await mutate('original-reference-table','reviewExtractionPublication','create-table',{definition:{
  name:'Published BCG reference: exact source quantities',questionIds:[questionId],
  description:REASON,columns:[...FIELDS,'vaccinated_total','control_total','followup_duration','risk_of_bias'].map(id=>({
   id,label:fieldDefinition(id).label,pointer:'/values/'+id+'/value',format:'typed'})),
  notes:'Thirteen source studies form one original cohort. The random-allocation sensitivity selects original trials 1,2,3,4,7,8,9. Study allocation labels and unreported follow-up remain explicit.'}});
 const page=await store.extractionPublications(dossierId,{section:'results',tableId:table.table.id,currentOnly:true,limit:100});
 need(page.complete&&page.total===13&&page.items.length===13&&page.items.every(value=>value.status==='RESOLVED'&&value.current),
  'BCG_COMPLETE_RESOLVED_NATIVE_RESULTS_REQUIRED');
 const nativeResults=resultSets.map(row=>{
  const result=page.items.find(value=>value.studyId===row.studyId&&value.record.row.id===row.referenceStudyId);
  need(result,'BCG_ORIGINAL_NATIVE_STUDY_RESULT_MISSING');return result;
 });
 const publication=await mutate('original-reference-publication','reviewExtractionPublication','publish-table',{
  tableId:table.table.id,tableEditionId:table.tableEdition.id,previousPublicationId:null,
  rows:nativeResults.map(value=>({resultId:value.resultId,editionId:value.editionId,fingerprint:value.fingerprint})),
  title:'Published BCG methods reference — thirteen source-bound studies',
  summary:'Original BCG vaccinated/control TB event and non-event counts, source author/year/allocation/latitude, and exact integer totals.',
  limitations:'Individual follow-up durations and independent design-specific risk-of-bias judgments are unreported in the retained reference. dat.colditz1994 is an alias of this cohort. Allocation subgrouping uses the original source labels.',
  reason:REASON,review:{contextFingerprint:page.reviewContext.fingerprint,
   note:'Reviewed all thirteen complete original Study/form/submission/resolution descriptors, exact quantities, source file/range/pointer bindings, alias and subgroup identities before this immutable publication.'}});
 const publicationId=publication.publication.id;
 const exported={};
 for(const format of ['json','csv','markdown','html']){
  abort();const output=await store.exportExtractionPublication(dossierId,{publicationId,format});
  const file=await retain(join(outputDirectory,output.filename),output.body);
  exported[format]={...file,contentType:output.contentType,revision:output.revision};
 }
 const rawPublication=await readFile(exported.json.path),report=JSON.parse(rawPublication);
 need(report.schema==='sf88-research-extraction-publication-report/v1'&&report.publicationId===publicationId&&
  report.publications.length===1&&report.publications[0].rows.length===13,'BCG_ORIGINAL_PUBLICATION_EXPORT_CHANGED');
 for(let index=0;index<projection.rows.length;index++){
  const row=projection.rows[index],frozen=report.publications[0].rows[index];
  need(frozen.result.studyId===resultSets[index].studyId&&frozen.result.status==='RESOLVED'&&
   frozen.result.sourceBindings.length>0,'BCG_FROZEN_NATIVE_DESCRIPTOR_CHANGED');
  for(const field of FIELDS)need(JSON.stringify(frozen.result.record.values[field].value)===JSON.stringify(['str',row.reported[field]]),
   'BCG_FROZEN_ORIGINAL_QUANTITY_CHANGED');
 }
 const replayEntry=journal.stages['trial-13-resolve'];
 if(!journal.stages['verified-original-replay']){
  const replayed=await store.reviewExtraction(dossierId,{...clone(replayEntry.request),projection:'metadata'});
  need(replayed.duplicate===true&&replayed.operation.id===replayEntry.response.operation.id&&
   replayed.operation.sha256===replayEntry.response.operation.sha256,'BCG_ORIGINAL_REQUEST_REPLAY_CHANGED');
  journal.stages['verified-original-replay']={requestId:replayEntry.request.requestId,
   operationId:replayed.operation.id,operationSha256:replayed.operation.sha256,duplicate:replayed.duplicate};
  await save();
 }
 const portablePath=join(outputDirectory,'bcg-reference-dossier.json.gz');
 let portableBytes;
 try{portableBytes=await readFile(portablePath);}
 catch(error){
  if(error.code!=='ENOENT')throw error;
  const portable=await store.exportStream(dossierId,{compression:'gzip',revision:exported.json.revision});
  const chunks=[];for await(const chunk of portable.body){abort();chunks.push(Buffer.from(chunk));}
  portableBytes=Buffer.concat(chunks);
 }
 const portableFile=await retain(portablePath,portableBytes);
 if(journal.stages['original-portable-export'])
  need(digest(journal.stages['original-portable-export'])===digest(portableFile),'BCG_ORIGINAL_PORTABLE_EXPORT_CHANGED');
 else{journal.stages['original-portable-export']=portableFile;await save();}
 const receivedDirectory=await privateDirectory(join(outputDirectory,'received-reference'));
 const receiving=await openDossierStore(receivedDirectory,{extractionOptions:{python,signal}});
 const reopened=await receiving.reopenStream(Readable.from([portableBytes]),{projection:'metadata'});
 need(reopened.id===dossierId,'BCG_RECEIVED_DOSSIER_ID_CHANGED');
 const receivedExport=await receiving.exportExtractionPublication(dossierId,{publicationId,format:'json'});
 need(receivedExport.body.equals(rawPublication),'BCG_RECEIVED_PUBLICATION_BYTES_CHANGED');
 const finalMetadata=await store.getMetadata(dossierId);
 const result={schema:'commons.bcg-original-publication-receiving/v1',operationId,state:'COMPLETE',
  dossierId,questionId,revision:finalMetadata.revision,publicationId,publicationSha256:publication.publication.sha256,
  publicationFile:exported.json,publicationFiles:exported,sourceBundle:bundleReceipt,sourceFiles:SOURCE_FILES,
  originalSourceBindings:resultSets,reviewId,protocolId:review.protocol.id,workSetId:workSet.workSet.id,
  eligibilityApplicationId:applied.application.id,sourceRows:13,reportedFields:FIELDS.length,sourceCells:117,
  randomAllocationReferenceStudyIds:projection.allocationSubgroups.random,
  aliasDeduplication:'dat.bcg and dat.colditz1994 refer to the same thirteen-study cohort',
  editableDossier:portableFile,receivedDirectory,receivedPublication:{bytes:receivedExport.body.length,sha256:sha(receivedExport.body)},
  sourceModules:moduleSources,journal:journalFile,completedAt:journal.complete?.completedAt??new Date().toISOString()};
 journal.complete=result;await save();await retain(join(outputDirectory,'bcg-publication-result.json'),jsonBytes(result));
 return result;
}

async function main(argv){
 const options={},keys=new Set(['source-root','reference-directory','dossier-directory','output-directory','operation-id','python']);
 for(let i=0;i<argv.length;i+=2){need(argv[i]?.startsWith('--')&&keys.has(argv[i].slice(2))&&typeof argv[i+1]==='string'&&
  !Object.hasOwn(options,argv[i].slice(2)),'BCG_ARGUMENT_INVALID');options[argv[i].slice(2)]=argv[i+1];}
 const controller=new AbortController();const stop=()=>controller.abort(Object.assign(new Error('Original BCG operation interrupted'),{code:'ABORT_ERR'}));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const result=await publishBcgReference({sourceRoot:options['source-root'],referenceDirectory:options['reference-directory'],
  dossierDirectory:options['dossier-directory'],outputDirectory:options['output-directory'],operationId:options['operation-id'],
  python:options.python??'python3',signal:controller.signal});process.stdout.write(JSON.stringify(result)+'\n');}
 finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main(process.argv.slice(2)).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??error.name,message:error.message})+'\n');process.exitCode=1;});
