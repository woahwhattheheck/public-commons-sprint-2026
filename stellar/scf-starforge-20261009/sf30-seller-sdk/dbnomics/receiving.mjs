// MIT. Complete same-operation analyst/publication/source receiving.
import {randomUUID} from 'node:crypto';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateDirectory} from '../postgres/publisher/files.mjs';
import {openDbnomicsWorkspace} from './workspace.mjs';
import {importDbnomicsInput,readOriginalFile,HASH} from './source.mjs';
import {optionalJson,exactFile,now} from './provider.mjs';
import {need,isRecord,operationId,text,digest,hash,jsonBytes,canonical,MAX_CAPTURE_BYTES} from './model.mjs';
import {prepareDbnomicsRelease,stageDbnomicsRelease} from './release.mjs';
const SCHEMA='stellar-forge.dbnomics-receiving.v1';
const RESULT='stellar-forge.dbnomics-receiving-result.v1';
const decode=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function normalize(input,directory){
 need(isRecord(input)&&Object.keys(input).every(k=>['schema','id','source','reviewer','reviewNote','notes','reports','query',
   'receivingDirectory','release','customer','waitMs','expectedRows'].includes(k)),'Use the documented complete receiving configuration.');
 need(input.schema===SCHEMA,'Use a DBnomics receiving configuration.');
 const id=operationId(input.id);need(id.length<=64,'The receiving ID must leave room for its original child operation names.');
 text(input.reviewer,'original source reviewer',128);text(input.reviewNote,'reviewed source and publication note',2000);
 need(isRecord(input.source)&&['example','import','live'].includes(input.source.kind),'Select included originals, a complete import, or one live acquisition.');
 const allowed=input.source.kind==='example'?['kind']:input.source.kind==='import'?['kind','file','expectedSha256']:['kind','selection','rights','timeoutMs'];
 need(Object.keys(input.source).every(k=>allowed.includes(k)),'Use the exact selected source input fields.');
 const source={...input.source};
 if(source.kind==='import'){
   need(typeof source.file==='string'&&source.file.startsWith('/'),'Use the absolute original import-manifest/capture file.');
   source.file=resolve(source.file);need(source.expectedSha256===undefined||HASH.test(source.expectedSha256),'Use the expected original input SHA256.');
 }
 const reports=input.reports??[{name:'levels',spec:{title:'Original economic observations',method:'level'}}];
 need(Array.isArray(reports)&&reports.length>0&&reports.length<=30,'Select one to thirty complete report outputs.');
 const names=new Set();
 for(const row of reports){
   need(isRecord(row)&&Object.keys(row).every(k=>['name','spec'].includes(k))&&isRecord(row.spec),'Use named complete report specifications.');
   operationId(row.name);need(row.name.length<=40&&!names.has(row.name),'Report names must be distinct and at most forty characters.');names.add(row.name);
 }
 const notes=input.notes??[];need(Array.isArray(notes)&&notes.length<=5000,'Use an explicit complete analyst note selection.');
 for(const row of notes){
   need(isRecord(row)&&Object.keys(row).every(k=>['id','seriesId','period','author','tag','text'].includes(k)),'Use original series/period anchors for receiving notes.');
   operationId(row.id);text(row.author,'analyst',160);text(row.text,'analyst note',16000);
   need((row.seriesId===null||row.seriesId===undefined)===(row.period===null||row.period===undefined),'Choose both an exact series and period, or a whole-edition note.');
 }
 need(isRecord(input.query)&&Object.keys(input.query).every(k=>['name','seriesIds','start','end','includeMissing','analysis'].includes(k)),
   'Supply the reviewed customer source selection.');
 need(/^[a-z][a-z0-9_-]{0,63}$/.test(input.query.name??''),'Use a lowercase saved query name.');
 const receivingDirectory=resolve(input.receivingDirectory??directory+'-received-'+id);
 for(const relation of [relative(directory,receivingDirectory),relative(receivingDirectory,directory)])
   need(relation!==''&&(relation==='..'||relation.startsWith('..'+sep)),'Keep receiving outside its original project.');
 const waitMs=input.waitMs??120000;need(Number.isSafeInteger(waitMs)&&waitMs>=1000&&waitMs<=600000,'Use a receiving extraction wait of 1–600 seconds.');
 need(input.expectedRows===undefined||Number.isSafeInteger(input.expectedRows)&&input.expectedRows>=0,'Use the exact expected original observation count.');
 if(input.release!==undefined)need(isRecord(input.release)&&Object.keys(input.release).every(k=>['paymentFile','origin','path','outputDirectory',
   'releaseDirectory','id','label','runtime','activationOptions','runOptions'].includes(k))&&typeof input.release.paymentFile==='string','Supply the existing native merchant terms file.');
 if(input.customer!==undefined)need(isRecord(input.customer)&&typeof input.release?.releaseDirectory==='string'&&input.release.id,'Native customer receiving uses the selected existing release store and original customer configuration.');
 return {...input,id,source,reports,notes,receivingDirectory,waitMs};
}
async function delivery(directory,name,content){
 const saved=await exactFile(directory,name,content);return {...saved,path:join(directory,name)};
}
async function verifyFiles(files){
 for(const file of files){
   const bytes=await readOriginalFile(file.path,MAX_CAPTURE_BYTES*3);
   need(bytes.length===file.bytes&&hash(bytes)===file.sha256,'An original receiving output changed.','DBNOMICS_RECEIVING_OUTPUT_CHANGED',409);
 }
}
export async function receiveDbnomics({directory,config,print=()=>{}}={}){
 directory=resolve(directory);config=normalize(config,directory);
 let originalSource=null,sourceBinding=null;
 if(config.source.kind!=='live'){
   const sourceFile=config.source.kind==='example'?fileURLToPath(new URL('./examples/insee-ipc.import.json',import.meta.url)):config.source.file;
   const bytes=await readOriginalFile(sourceFile);
   if(config.source.expectedSha256)need(hash(bytes)===config.source.expectedSha256,'The selected source input changed.');
   originalSource=await importDbnomicsInput(sourceFile);
   sourceBinding={inputSha256:hash(bytes),captureId:originalSource.captureId,captureSha256:hash(jsonBytes(originalSource))};
 }
 const inputHash=digest({config,sourceBinding});
 let workbench=await openDbnomicsWorkspace({directory,create:true}),received=null;
 const opDirectory=join(directory,'receiving',config.id);await privateDirectory(join(directory,'receiving'),true);await privateDirectory(opDirectory,true);
 const outputsDirectory=join(opDirectory,'delivery');await privateDirectory(outputsDirectory,true);
 let intent=await optionalJson(join(opDirectory,'operation.json'),1024*1024);
 if(intent)need(intent.schema===SCHEMA&&intent.inputHash===inputHash&&intent.projectId===workbench.settings.id,
   'Continue the same receiving operation with its original source and configuration.','DBNOMICS_RECEIVING_CONFLICT',409);
 else{
   intent={schema:SCHEMA,id:config.id,inputHash,config,sourceBinding,projectId:workbench.settings.id,
     createdAt:now(),extractionId:randomUUID()};
   await exactFile(opDirectory,'operation.json',jsonBytes(intent));
 }
 const log=(phase,value)=>print({operation:config.id,phase,...value});
 try{
   const imported=config.source.kind==='live'?await workbench.acquire({id:config.id+'-source',
     selection:config.source.selection,rights:config.source.rights,timeoutMs:config.source.timeoutMs}):
     await workbench.importCapture({id:config.id+'-source',capture:originalSource});
   const retained=await workbench.capture(imported.captureId),captureId=retained.capture.captureId;
   if(config.expectedRows!==undefined)need(retained.model.rowCount===config.expectedRows,'The original source row population changed.');
   log('SOURCE_RETAINED',{captureId,rows:retained.model.rowCount,series:retained.model.series.length,sourceMode:retained.capture.sourceMode});
   const entries=config.notes.map(row=>{
     const observation=row.seriesId==null?null:retained.model.rows.find(value=>value.seriesId===row.seriesId&&value.period===row.period);
     need(row.seriesId==null||observation,'The selected note anchor is absent from the original source.');
     return {id:row.id,observationId:observation?.observationId??null,author:row.author,tag:row.tag??'',text:row.text};
   });
   let noteEdition={revision:0,entries:[],sha256:null};
   if(entries.length)noteEdition=await workbench.saveNotes({id:config.id+'-notes',captureId,expectedRevision:0,entries});
   const reports=[],files=[];
   for(const selection of config.reports){
     const report=await workbench.saveReport({id:config.id+'-'+selection.name,captureId,spec:selection.spec,notesRevision:noteEdition.revision});
     const exported={};
     for(const format of ['json','csv','html']){
       const output=await workbench.exportReport(report.id,format);
       const original=await readOriginalFile(output.path);
       exported[format]=await delivery(outputsDirectory,selection.name+'.'+format,original);files.push(exported[format]);
     }
     reports.push({...report,files:exported});
   }
   log('ANALYSIS_SAVED',{notesRevision:noteEdition.revision,reports:reports.map(row=>({id:row.id,rows:row.rows,unavailable:row.unavailable}))});
   const source=await workbench.publisher.source(),{name,...selection}=config.query;
   const requestedQuery={captureId,...selection,review:{reviewer:config.reviewer,note:config.reviewNote}};
   let queryInput=await optionalJson(join(opDirectory,'query-operation-input.json'),2*1024*1024);
   if(!queryInput){
     const previous=await optionalJson(join(directory,'operations',config.id+'-query.intent.json'),2*1024*1024);
     if(previous)need(previous.id===config.id+'-query'&&previous.kind==='SAVE_QUERY'&&previous.inputHash===digest(previous.input)&&
       previous.input.name===name&&canonical(previous.input.query)===canonical(requestedQuery),
       'The retained source query belongs to another original receiving decision.','DBNOMICS_RECEIVING_QUERY_CHANGED',409);
     queryInput=previous?{id:previous.id,...previous.input}:{id:config.id+'-query',name,expectedHash:source.hash,query:requestedQuery};
     await exactFile(opDirectory,'query-operation-input.json',jsonBytes(queryInput));
   }
   const query=await workbench.saveQuery(queryInput);
   const planInputFile=join(opDirectory,'publication-plan-input.json');
   let planInput=await optionalJson(planInputFile,8*1024*1024);
   if(!planInput){
     planInput={id:config.id+'-plan',plan:await workbench.planTemplate(name)};
     await exactFile(opDirectory,'publication-plan-input.json',jsonBytes(planInput));
   }
   const saved=await workbench.savePublicationPlan(planInput),plan=saved.plan;
   workbench.startPublication({id:intent.extractionId,planId:plan.id});
   const deadline=Date.now()+config.waitMs;
   while(workbench.publisher.run(intent.extractionId).state==='EXTRACTING'&&Date.now()<deadline)await sleep(50);
   let run=workbench.publisher.run(intent.extractionId);
   need(run.state!=='EXTRACTING','The original extraction is still active; inspect its retained ID.','DBNOMICS_RECEIVING_EXTRACTION_ACTIVE',409);
   if(['PUBLICATION_UNKNOWN','PUBLISHING','INTERRUPTED','FAILED','CANCELLED'].includes(run.state)){
     await workbench.publisher.recover(run.id);run=workbench.publisher.run(run.id);
   }
   if(run.state==='READY'){
     const target=await workbench.publisher.target();
     run=await workbench.publisher.review(run.id,{initialize:target.initializable===true,reviewer:config.reviewer,note:config.reviewNote,
       ...(target.connected?{expectedSnapshot:target.versions.current,expectedRevision:target.versions.revision}:{})});
   }
   if(run.state==='REVIEWED'){
     need(run.data.review.reviewer===config.reviewer&&run.data.review.note===config.reviewNote,
       'The current native candidate review belongs to another decision.','DBNOMICS_RECEIVING_REVIEW_CHANGED',409);
     run=await workbench.publisher.publish(run.id,run.data.review.id);
   }
   need(run.state==='PUBLISHED','The original publication returned '+run.state+': '+JSON.stringify(run.data?.error??null),
     'DBNOMICS_RECEIVING_PUBLICATION_INCOMPLETE',409);
   const candidate=await workbench.publisher.candidate(run.id),description=candidate.dataset.describe();
   need(run.data.publication.snapshot===description.snapshot,'The actual publication snapshot changed.');
   const csv=await readOriginalFile(join(workbench.settings.publisherDirectory,'runs',run.id,'data.csv'));
   const customerCsv=await delivery(outputsDirectory,'customer-dataset.csv',csv);files.push(customerCsv);
   const preview=candidate.dataset.handle({query:new URLSearchParams('limit=250')});
   need(preview.status===200,'The actual native customer query returned an error.');
   const candidateMetadata=await delivery(outputsDirectory,'customer-edition.json',jsonBytes({
     planId:plan.id,runId:run.id,snapshot:description.snapshot,dataset:description,
     review:run.data.review,publication:run.data.publication,extraction:candidate.manifest.extraction,preview:preview.body}));
   files.push(candidateMetadata);
   log('PUBLISHED',{runId:run.id,planId:plan.id,snapshot:description.snapshot,rows:description.rowCount});
   let release=null;
   if(config.release){
     const selected=config.release,paymentBytes=await readOriginalFile(resolve(selected.paymentFile),1024*1024);
     const paymentBinding=await optionalJson(join(opDirectory,'payment-binding.json'),16384);
     const expected={file:resolve(selected.paymentFile),sha256:hash(paymentBytes)};
     if(paymentBinding)need(canonical(paymentBinding)===canonical(expected),'The original public merchant terms file changed.');
     else await exactFile(opDirectory,'payment-binding.json',jsonBytes(expected));
     const payment=decode(paymentBytes);
     release={prepared:await prepareDbnomicsRelease({publisher:workbench.publisher,runId:run.id,
       outputDirectory:resolve(selected.outputDirectory),payment,origin:selected.origin,path:selected.path})};
     if(selected.releaseDirectory)release.staged=await stageDbnomicsRelease({
       packageDirectory:release.prepared.directory,releaseDirectory:resolve(selected.releaseDirectory),
       id:selected.id,label:selected.label,runtime:selected.runtime});
     log('RELEASE_PREPARED',{directory:release.prepared.directory,snapshot:release.prepared.snapshot,stagedId:release.staged?.id??null});
   }
   const handoverPath=join(outputsDirectory,'source-handover.json');
   let handover=await optionalJson(handoverPath,MAX_CAPTURE_BYTES*3);
   if(!handover){
     handover=await workbench.exportSources();await exactFile(outputsDirectory,'source-handover.json',jsonBytes(handover));
   }
   need(handover.captures.some(value=>value.captureId===captureId)&&reports.every(report=>handover.reports.some(value=>value.reportId===report.id&&value.captureId===captureId))&&canonical(handover.sourceConfig.queries[name])===canonical(query.query),'The retained receiving handover changed.');
   const handoverBytes=await readOriginalFile(handoverPath,MAX_CAPTURE_BYTES*3);
   files.push({path:handoverPath,filename:'source-handover.json',bytes:handoverBytes.length,sha256:hash(handoverBytes)});
   const customer=config.customer?await (await import('./customer.mjs')).receiveDbnomicsCustomer({workbench,runId:run.id,
     release:config.release,prepared:release.prepared,config:config.customer,directory:join(opDirectory,'customer'),handover,print}):null;
   const originalProject=workbench.settings.id,originalSnapshot=description.snapshot;
   await workbench.close();workbench=null;
   // Receiving uses the maintained source importer and a separate original publisher workspace.
   received=await openDbnomicsWorkspace({directory:config.receivingDirectory,create:true});
   const adoption=await received.importSources({id:config.id+'-receive',bundle:handover});
   const receivingCapture=await received.capture(captureId);
   need(receivingCapture.captureSha256===retained.captureSha256&&receivingCapture.model.rowCount===retained.model.rowCount,
     'The received source differs from the exact original capture.');
   for(const row of reports){
     const report=await received.report(row.id);need(report.sha256===row.sha256,'A received full analyst report changed.');
   }
   const receivedStatus=await received.status();await received.close();received=null;
   workbench=await openDbnomicsWorkspace({directory});
   const reopened=workbench.publisher.run(intent.extractionId),sameCapture=await workbench.capture(captureId);
   need(workbench.settings.id===originalProject&&reopened.state==='PUBLISHED'&&reopened.data.publication.snapshot===originalSnapshot&&
     sameCapture.captureSha256===retained.captureSha256,'The original project did not reopen its same source and publication.');
   await verifyFiles(files);
   const result={schema:RESULT,operationId:config.id,projectId:originalProject,directory,
     capture:{id:captureId,sha256:retained.captureSha256,sourceMode:retained.capture.sourceMode,
       rows:retained.model.rowCount,missing:retained.model.missing,series:retained.model.series.map(({metadata,...row})=>row),
       receipts:retained.capture.responses.map(row=>row.receipt),terms:retained.capture.terms},
     notes:{revision:noteEdition.revision,sha256:noteEdition.sha256,entries:noteEdition.entries.length},
     reports,query:query.name,planId:plan.id,runId:run.id,snapshot:description.snapshot,
     publishedRows:description.rowCount,publication:reopened.data.publication,release,customer,
     sourceHandover:{path:handoverPath,bundleSha256:handover.bundleSha256},
     receiving:{directory:config.receivingDirectory,projectId:receivedStatus.project.id,adoption,
       captureSha256:receivingCapture.captureSha256,rows:receivingCapture.model.rowCount,reports:reports.length},
     reopened:{projectId:workbench.settings.id,runId:reopened.id,state:reopened.state,snapshot:originalSnapshot},
     files,completedAt:now()};
   const old=await optionalJson(join(opDirectory,'result.json'),8*1024*1024);
   if(old){
     need(old.operationId===result.operationId&&old.projectId===result.projectId&&old.capture.sha256===result.capture.sha256&&
       old.runId===result.runId&&old.snapshot===result.snapshot&&old.sourceHandover.bundleSha256===result.sourceHandover.bundleSha256,
       'The original completed receiving result changed.');
     await verifyFiles(old.files);log('COMPLETE',{resultFile:join(opDirectory,'result.json'),replayed:true,rows:old.capture.rows,reports:old.reports.length});
     return {...old,replayed:true};
   }
   await exactFile(opDirectory,'result.json',jsonBytes(result));
   log('COMPLETE',{resultFile:join(opDirectory,'result.json'),replayed:false,rows:result.capture.rows,reports:result.reports.length});
   return {...result,replayed:false};
 }finally{await received?.close();await workbench?.close();}
}
