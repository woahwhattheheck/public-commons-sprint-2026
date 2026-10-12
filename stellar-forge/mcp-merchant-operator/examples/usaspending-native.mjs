#!/usr/bin/env node
// MIT. Operate the original USAspending application through its configured merchant MCP interface.
import { mkdir, readFile, writeFile, rename, chmod, stat, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { MerchantUSASpendingWorkspaces, readUSASpendingWorkspaceConfiguration } from '../usaspending-workspace.mjs';
import { COLUMNS, sha, canonical, addDecimals } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/core.mjs';
import { init as initDelivery, appendMany, scan as scanDelivery, finalize } from '../../../stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs';
import { recoverUSAspendingEdition } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/dossier.mjs';

const args=Object.create(null);
for(let i=2;i<process.argv.length;i+=2){if(!/^--[a-z-]+$/.test(process.argv[i])||!process.argv[i+1])throw Error('Use --source COLLECTION --out DIRECTORY --operation ID');args[process.argv[i].slice(2)]=process.argv[i+1];}
if(!args.source||!args.out||!args.operation)throw Error('Use --source COLLECTION --out DIRECTORY --operation ID');
const out=resolve(args.out),source=resolve(args.source),operationId=args.operation;
const exists=async path=>{try{return await readFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const check=(condition,code,detail='')=>{if(!condition)throw Object.assign(Error(code+(detail?': '+detail:'')),{code});};
const safeOpen=value=>({workspace:value.workspace,workspaceId:value.workspaceId,instanceId:value.instanceId,counts:value.counts,
  browserOrigin:value.browserUrl?new URL(value.browserUrl).origin:null,dossierOrigin:value.dossierBrowserUrl?new URL(value.dossierBrowserUrl).origin:null});
await mkdir(out,{recursive:true,mode:0o700});await chmod(out,0o700);
const journalPath=join(out,'operation.json'),sourceSha=sha(await readFile(source));
const previous=await exists(journalPath);
const journal=previous?JSON.parse(previous):{schema:'stellar-forge.usaspending-mcp-native.v1',operationId,sourceSha256:sourceSha,startedAt:new Date().toISOString(),status:'running',steps:{},exports:{}};
check(journal.operationId===operationId&&journal.sourceSha256===sourceSha,'ORIGINAL_OPERATION_CHANGED');
const checkpoint=async()=>{const tmp=journalPath+'.next';await writeFile(tmp,JSON.stringify(journal,null,2)+'\n',{mode:0o600});await rename(tmp,journalPath);};
const retain=async(path,body)=>{const bytes=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body,null,2)+'\n');const old=await exists(path);if(old){check(sha(old)===sha(bytes),'RETAINED_OUTPUT_CHANGED',path);return {file:path,bytes:old.length,sha256:sha(old)};}await writeFile(path,bytes,{flag:'wx',mode:0o600});return {file:path,bytes:bytes.length,sha256:sha(bytes)};};
const step=async(name,fn)=>{if(journal.steps[name])return journal.steps[name];journal.currentStep=name;await checkpoint();const value=await fn();journal.steps[name]=value;await checkpoint();process.stdout.write(JSON.stringify({operationId,step:name,state:'complete',...(['source_import','source_research','original_delivery','workspace_restore'].includes(name)?value:{})})+'\n');return value;};
for(const folder of ['research','dossiers','exports','native-pages','downloads'])await mkdir(join(out,folder),{recursive:true,mode:0o700});
const deliveryRoot=join(out,'original-delivery');
if(!await exists(join(deliveryRoot,'session.json'))){try{await rmdir(deliveryRoot);}catch(error){if(error.code!=='ENOENT')throw error;}await initDelivery(deliveryRoot);}
const connectionPath=join(out,'connection.json');
const connection={schema:'stellar-forge.usaspending-workspace-connection.v1',workspaces:{federal:{
  label:'Federal AI and IT award research',directory:join(out,'research'),dossierDirectory:join(out,'dossiers'),operator:'Federal research operator',
  sources:{'original-cohort':{kind:'collection',file:source,sha256:sourceSha}},deliveries:{'original-buyer':join(out,'original-delivery')},merchant:{defaultLimit:5,maxLimit:100}
}}};
await retain(connectionPath,connection);
let adapter,opened;
const start=async()=>{adapter=new MerchantUSASpendingWorkspaces({usaSpendingWorkspaces:await readUSASpendingWorkspaceConfiguration(connectionPath),exportsDirectory:join(out,'exports')});opened=await adapter.call('merchant_usaspending_open',{workspace:'federal'});return opened;};
const call=async(name,input={},workspace='federal')=>{const value=await adapter.call('merchant_usaspending_'+name,{workspace,...input});return Object.hasOwn(value,'native')?value.native:value;};
const pages=async(kind)=>{let offset=0,snapshot,all=[];do{const p=await call('inventory',{kind,offset,limit:100,...(snapshot?{expectedSnapshot:snapshot}:{})});all.push(...p.items);snapshot=p.snapshot;offset=p.nextOffset;}while(offset!==null);return all;};
const dossierPage=async(dossierId,section)=>{let offset=0,snapshot,all=[],view;do{view=await call('dossier',{dossierId,section,offset,limit:100,...(snapshot?{expectedSnapshot:snapshot}:{})});all.push(...view.page.items);snapshot=view.page.snapshot;offset=view.page.nextOffset;}while(offset!==null);return {...view,items:all};};
const keepExport=async(label,kind,selection={})=>{if(journal.exports[label])return journal.exports[label];const value=await call('export',{kind,...selection});journal.exports[label]=value;await checkpoint();return value;};
const download=async(label,record,{resumeAfterClose=false}={})=>{
  const path=join(out,'downloads',label+'.'+record.file.name.split('.').at(-1));
  const saved=await exists(path);if(saved){check(saved.length===record.file.bytes&&sha(saved)===record.exportId,'EXPORTED_BYTES_CHANGED');return {file:path,bytes:saved.length,sha256:sha(saved),resumed:resumeAfterClose};}
  const chunks=[];let offset=0,readId,closed=false;
  while(offset<record.file.bytes){
    const value=await call('file_read',{kind:record.kind,exportId:record.exportId,offset,limit:65536,...(readId?{readId}:{})});
    const bytes=Buffer.from(value.data,'base64');check(value.offset===offset&&bytes.length===value.bytesRead&&value.file.sha256===record.exportId,'RETAINED_CHUNK_CHANGED');
    chunks.push(bytes);offset+=bytes.length;readId=value.readId;
    check(value.nextOffset===(offset<record.file.bytes?offset:null),'RETAINED_CHUNK_SEQUENCE_CHANGED');
    if(resumeAfterClose&&!closed&&offset<record.file.bytes){
      const closedResult=await call('close',{instanceId:opened.instanceId});await adapter.close();
      const oldWorkspace=opened.workspaceId;await start();check(opened.workspaceId===oldWorkspace,'REOPENED_WORKSPACE_CHANGED');
      journal.chunkContinuation={exportId:record.exportId,kind:record.kind,offset,closedInstance:closedResult.instanceId,reopenedInstance:opened.instanceId};await checkpoint();
      readId=undefined;closed=true;
    }
  }
  const all=Buffer.concat(chunks);check(all.length===record.file.bytes&&sha(all)===record.exportId,'COMPLETE_EXPORT_CHANGED');
  await retain(path,all);return {file:path,bytes:all.length,sha256:sha(all),resumed:closed,chunks:chunks.length};
};
try{
  await start();
  journal.workspaceId??=opened.workspaceId;check(journal.workspaceId===opened.workspaceId,'ORIGINAL_WORKSPACE_CHANGED');
  await step('configured_open',async()=>safeOpen(opened));
  await step('operator_browser',async()=>{
    const response=await fetch(new URL('/',opened.browserUrl));const bytes=Buffer.from(await response.arrayBuffer());
    check(response.status===200&&bytes.includes(Buffer.from('Federal Award Research')),'ORIGINAL_OPERATOR_HTML_FAILED');
    const dossierResponse=await fetch(new URL('/',opened.dossierBrowserUrl));check(dossierResponse.status===200,'ORIGINAL_DOSSIER_HTML_FAILED');
    const a=await retain(join(out,'operator.html'),bytes),b=await retain(join(out,'dossier-operator.html'),Buffer.from(await dossierResponse.arrayBuffer()));
    return {researchStatus:response.status,dossierStatus:dossierResponse.status,research:a,dossier:b};
  });
  const imported=await step('source_import',async()=>{
    const result=await call('source_import',{source:'original-cohort'});check((result.failures??[]).length===0,'SOURCE_COLLECTION_INCOMPLETE',JSON.stringify(result.failures));return result;
  });
  const editionId=imported.editionId;
  const rows=[];
  for(let page=1;;page++){const result=await call('rows',{editionId,page,limit:5});rows.push(...result.rows);if(rows.length===result.total)break;check(result.rows.length>0&&rows.length<result.total,'SOURCE_ROW_PAGINATION_CHANGED');}
  const overview=await call('edition',{editionId,limit:5});
  await step('source_research',async()=>{
    const result={editionId,captureId:imported.captureId,rows:rows.length,
      obligationUsd:addDecimals(rows.map(r=>r.total_obligation_usd)),exercisedUsd:addDecimals(rows.map(r=>r.exercised_usd)),potentialUsd:addDecimals(rows.map(r=>r.potential_usd)),
      outlaysKnown:rows.filter(r=>r.outlays_usd!==null).length,coverage:overview.coverage};
    check(rows.length===15&&result.obligationUsd==='29461170.92'&&result.exercisedUsd==='29465539.92'&&result.potentialUsd==='105824144.08','RETAINED_COHORT_SEMANTICS_CHANGED');
    await retain(join(out,'research-findings.json'),result);return result;
  });
  const focus=rows.find(r=>r.recipient_uei==='E9GWUWJTVME7');check(focus&&focus.parent_recipient_uei==='FJKXXRJG14R5','PRIME_PARENT_IDENTITY_CHANGED');
  await step('saved_query',async()=>{
    const queries=await pages('queries'),name='Federal AI and IT prime cohort';
    const prior=queries.find(q=>q.definition?.name===name);
    if(prior)return {queryId:prior.id,revision:prior.revision};
    const value=await call('query_save',{expectedRevision:0,definition:{name,startDate:'2026-09-01',endDate:'2026-10-11',dateType:'new_awards_only',keywords:['artificial intelligence'],naics:['541511','541512','541513','541519'],awardTypes:['A','B','C','D'],minimumAwardUsd:100000,maximumAwardUsd:20000000,pageSize:50,maxRows:250000}});
    const saved=await call('query',{queryId:value.id});return {queryId:saved.id,revision:saved.revision};
  });
  await step('analyst_review',async()=>{
    const reviews=await pages('reviews'),prior=reviews.find(r=>r.award_key===focus.award_key);
    const review={status:'researching',fit:'This retained FEMA OCIO AI support order provides a concrete service and agency cohort for technical qualification.',
      workshare:'Configure agreed agency and service cohorts, qualify recipient and parent entities, and prepare source-linked implementation workshares.',
      deliverables:'Saved cohort, original award sources, qualified analyst brief, receiving dataset and portable research dossier.',
      acceptance:'The receiving operator can inspect original source and delivered pages and continue the same review.',
      constraints:'Agreed service scope and first-party capability references are recorded by the commercial owner.',notes:'Derived from the original public award collection.',businessFitUrls:[]};
    const saved=prior??await call('review_save',{editionId,awardKey:focus.award_key,expectedRevision:0,review});
    const award=await call('award',{editionId,awardKey:focus.award_key});check(award.review?.revision===saved.revision&&award.review?.data?.workshare===saved.data.workshare,'CURRENT_AWARD_REVIEW_MISSING');
    return {awardKey:focus.award_key,revision:saved.revision,sourceEditionId:award.review.data.sourceEditionId,status:award.review.data.status};
  });
  const selection=await step('selected_edition',async()=>await call('select',{editionId,awardKeys:rows.filter(r=>['E9GWUWJTVME7','YUZFZ7G7J7D3'].includes(r.recipient_uei)).map(r=>r.award_key),name:'Selected AI support and technical training awards'}));
  await step('edition_comparison',async()=>{
    const value=await call('compare',{before:editionId,after:selection.id,limit:100});await retain(join(out,'selection-comparison.json'),value);return {before:editionId,after:selection.id,changes:value.changes.total};
  });
  const merchant=await step('merchant_preparation',async()=>{
    const prior=(await pages('publications')).find(p=>p.edition_id===editionId&&p.data.merchantId);
    if(prior)return {merchantId:prior.data.merchantId,snapshot:prior.data.snapshot,publicationId:prior.id};
    let job;
    if(journal.merchantJob){const status=await call('status');if(status.jobs.some(j=>j.id===journal.merchantJob))job=await call('job',{jobId:journal.merchantJob});}
    if(!job){job=await call('merchant_prepare',{editionId});journal.merchantJob=job.id;await checkpoint();}
    while(job.status==='running'){await new Promise(r=>setTimeout(r,150));job=await call('job',{jobId:job.id});}
    check(job.status==='complete','MERCHANT_PREPARATION_FAILED',JSON.stringify(job.error));
    return {merchantId:job.result.merchantId,snapshot:job.result.snapshot,publicationId:job.result.id,jobId:job.id};
  });
  const delivery=await step('original_delivery',async()=>{
    const inputs=[];let cursor,index=0;
    do{
      const pageFile=join(out,'native-pages','page-'+index+'.json'),evidence=join(out,'native-pages','page-'+index+'.source.json');
      const query={fields:COLUMNS.join(','),limit:'5',...(cursor?{cursor}:{})};
      let bytes=await exists(pageFile),body;
      if(bytes)body=JSON.parse(bytes);else{
        const value=await call('merchant_preview',{merchantId:merchant.merchantId,query});
        check(value.mode==='local_dataset_read'&&value.result.status===200,'ORIGINAL_DATASET_PREVIEW_FAILED');
        body=value.result.body;bytes=Buffer.from(JSON.stringify(body)+'\n');await retain(pageFile,bytes);
      }
      if(!await exists(evidence))await retain(evidence,{sourceKind:'local_dataset_read',operationId,editionId,merchantId:merchant.merchantId,snapshot:merchant.snapshot,query,observedAt:new Date().toISOString(),responseSha256:sha(bytes),responseBytes:bytes.length});
      inputs.push({page:pageFile,evidence,intent:'local-dataset-read-'+overview.edition.sha256.slice(0,20)+'-p'+index,...(cursor?{cursor}:{})});cursor=body.page.nextCursor;index++;
    }while(cursor);
    const directory=join(out,'original-delivery');if(!await exists(join(directory,'session.json')))await initDelivery(directory);
    let state=await scanDelivery(directory);
    for(let i=0;i<state.pages.length;i++)check(state.pages[i].intent===inputs[i]?.intent,'ORIGINAL_DELIVERY_PREFIX_CHANGED');
    if(!state.finalized){if(state.pages.length<inputs.length)await appendMany(directory,inputs.slice(state.pages.length));await finalize(directory);}
    state=await scanDelivery(directory);check(state.count===rows.length&&state.nextCursor===null,'ORIGINAL_DELIVERY_INCOMPLETE');
    return {sourceKind:'local_dataset_read',pages:state.pages.length,rows:state.count,snapshot:state.snapshot,chain:state.chain,operationHandles:inputs.map(x=>x.intent)};
  });
  const received=await step('delivery_adoption',async()=>await call('delivery_adopt',{delivery:'original-buyer'}));
  await step('delivery_replay',async()=>{
    const value=await call('delivery_adopt',{delivery:'original-buyer'});check(value.editionId===received.editionId&&value.replayed,'ORIGINAL_DELIVERY_REPLAY_CHANGED');return {editionId:value.editionId,replayed:value.replayed,sourceAttached:value.sourceAttached};
  });
  let dossierId=journal.dossierId;
  if(!dossierId){const prior=(await pages('dossiers')).find(d=>d.title==='Federal AI and IT source qualification');const d=prior??await call('dossier_create',{title:'Federal AI and IT source qualification',description:'Original public award research, native delivered pages and analyst implementation findings.'});dossierId=d.id;journal.dossierId=dossierId;await checkpoint();}
  const questions=['Which original prime identities, agency roles, distinct award amounts and current performance dates govern qualification?',
    'Which source descriptions identify an AI support or technical training implementation workshare?'];
  journal.questionIds??=[];journal.receiveReceipts??=[];
  for(let i=0;i<questions.length;i++){
    let current=await dossierPage(dossierId,'questions');
    let question=current.items.find(q=>q.text===questions[i]);
    if(!question){current=await call('dossier_question',{dossierId,expectedRevision:current.revision,text:questions[i]});question=current.questions.find(q=>q.text===questions[i]);}
    journal.questionIds[i]=question.id;await checkpoint();
    if(!journal.receiveReceipts[i]){
      current=await call('dossier',{dossierId});
      journal.receiveReceipts[i]=await call('dossier_receive',{dossierId,editionId:received.editionId,questionId:question.id,expectedRevision:current.revision,includeReviews:false});await checkpoint();
    }
  }
  const fullSource=await step('dossier_original_source',async()=>{
    const current=await call('dossier',{dossierId});
    return call('dossier_receive',{dossierId,editionId,questionId:journal.questionIds[0],expectedRevision:current.revision,includeReviews:false});
  });
  await step('dossier_question_replay',async()=>{
    const current=await call('dossier',{dossierId}),value=await call('dossier_receive',{dossierId,editionId:received.editionId,questionId:journal.questionIds[1],expectedRevision:current.revision,includeReviews:false});
    check(value.importedComponents===0&&value.reusedComponents===journal.receiveReceipts[1].componentCount,'QUESTION_NATIVE_REPLAY_CHANGED');
    check(canonical(value.components.map(c=>c.dossierEditionId))===canonical(journal.receiveReceipts[1].components.map(c=>c.dossierEditionId)),'QUESTION_NATIVE_EDITION_BINDING_CHANGED');
    return value;
  });
  const findings=[
    {questionId:journal.questionIds[0],title:'Distinct federal award values and unknown outlays',selected:rows,
      text:'The fifteen retained awards report obligations of USD '+addDecimals(rows.map(r=>r.total_obligation_usd))+', base and exercised options of USD '+addDecimals(rows.map(r=>r.exercised_usd))+
        ', and base and all options of USD '+addDecimals(rows.map(r=>r.potential_usd))+'. All fifteen total-outlay fields are null. The separate original account-outlay fields remain in the detail source.'},
    {questionId:journal.questionIds[0],title:'Recipient, parent, agency and performance-date qualification',
      selected:rows.filter(r=>r.recipient_uei!==r.parent_recipient_uei||r.total_obligation_usd!==r.exercised_usd||!r.awarding_agency),
      text:rows.filter(r=>r.recipient_uei!==r.parent_recipient_uei||r.total_obligation_usd!==r.exercised_usd||!r.awarding_agency).map(r=>r.piid+': recipient '+r.recipient_uei+
        ', parent '+(r.parent_recipient_uei??'unreported')+', obligation '+r.total_obligation_usd+', exercised '+r.exercised_usd+
        ', awarding '+(r.awarding_agency??'unreported')+', funding '+(r.funding_agency??'unreported')+', current end '+(r.performance_end??'unreported')+'.').join('\n')},
    {questionId:journal.questionIds[1],title:'AI support and technical training workshare inputs',
      selected:rows.filter(r=>['E9GWUWJTVME7','YUZFZ7G7J7D3'].includes(r.recipient_uei)),
      text:rows.filter(r=>['E9GWUWJTVME7','YUZFZ7G7J7D3'].includes(r.recipient_uei)).map(r=>r.recipient_name+' / '+r.piid+'\n'+r.description+'\nNAICS '+r.naics+'; PSC '+r.psc+
        '; current period '+r.performance_start+' to '+r.performance_end+'.').join('\n\n')}
  ];
  await step('cited_dossier_findings',async()=>{
    for(const finding of findings){
      let view=await dossierPage(dossierId,'findings');if(view.items.some(f=>f.title===finding.title&&f.questionId===finding.questionId))continue;
      const sources=await dossierPage(dossierId,'sources');
      const sourceIds=finding.selected.map(row=>{const value=sources.items.find(s=>s.url===row.source_url&&s.citations.some(c=>c.questionId===finding.questionId));check(value,'ORIGINAL_FINDING_SOURCE_MISSING',row.award_key);return value.id;});
      for(const sourceId of sourceIds){const current=await call('dossier',{dossierId});await call('dossier_evidence',{dossierId,sourceId,expectedRevision:current.revision,selected:true,classification:'supports',note:'Original award evidence for qualification and implementation scope.'});}
      view=await call('dossier',{dossierId});await call('dossier_finding',{dossierId,expectedRevision:view.revision,questionId:finding.questionId,title:finding.title,text:finding.text,sourceIds});
    }
    const view=await dossierPage(dossierId,'findings');return {dossierId,revision:view.revision,findings:view.items.map(f=>({id:f.id,title:f.title,questionId:f.questionId,sourceCount:f.sourceIds.length}))};
  });
  const exportPlan=[
    ['full-source','edition-json',{editionId}],['received-source','edition-json',{editionId:received.editionId}],
    ['selected-source','edition-json',{editionId:selection.id}],['research-workspace','workspace',{}],
    ['research-dossier','dossier-json',{dossierId}],['research-report','dossier-md',{dossierId}],['research-report-html','dossier-html',{dossierId}],
    ['award-workshare','brief',{editionId,awardKey:focus.award_key}],['original-query-page','source-page',{captureId:imported.captureId,page:1}],
    ['merchant-awards','merchant-csv',{merchantId:merchant.merchantId}],['merchant-source','merchant-source',{merchantId:merchant.merchantId}]
  ];
  for(const [label,kind,selection]of exportPlan){
    const retained=await keepExport(label,kind,selection);
    await step('download_'+label,()=>download(label,retained,{resumeAfterClose:label==='research-dossier'}));
  }
  await step('portable_source_recovery',async()=>{
    const portable=JSON.parse(await readFile(journal.steps['download_research-dossier'].file));
    const delivered=journal.receiveReceipts.map((receipt,i)=>recoverUSAspendingEdition(portable,receipt.sourceSignature,{questionId:journal.questionIds[i]}));
    for(let i=0;i<delivered.length;i++)check(delivered[i].sha256===journal.receiveReceipts[i].firstPacketSha256,'ORIGINAL_RECEIVED_PACKET_CHANGED');
    const original=recoverUSAspendingEdition(portable,fullSource.sourceSignature,{questionId:journal.questionIds[0]});
    check(original.sha256===fullSource.firstPacketSha256&&original.details.length===15&&original.sourcePages.length===1,'ORIGINAL_SOURCE_PACKET_CHANGED');
    check(delivered[0].buyerDelivery.archives.length===delivery.pages,'ORIGINAL_NATIVE_ARCHIVES_CHANGED');
    const selected=JSON.parse(await readFile(journal.steps['download_selected-source'].file));
    check(selected.coverage.completeCapture===true&&selected.coverage.currentEditionCompleteCohort===false,'SELECTED_COHORT_COVERAGE_CHANGED');
    return {sourceRows:original.rows.length,detailRecords:original.details.length,originalPages:original.sourcePages.length,nativeArchives:delivered[0].buyerDelivery.archives.length,
      firstPacketSha256:original.sha256,receivedPacketSha256:delivered[0].sha256};
  });
  await step('workspace_restore',async()=>{
    await call('close',{instanceId:opened.instanceId});await adapter.close();
    const receivingConnection=join(out,'receiving-connection.json');
    const receiving={schema:connection.schema,workspaces:{receiving:{directory:join(out,'restored-research'),dossierDirectory:join(out,'restored-dossiers'),operator:'Receiving research operator',
      sources:{workspace:{kind:'workspace',file:journal.steps['download_research-workspace'].file,sha256:journal.exports['research-workspace'].exportId},
        dossier:{kind:'dossier',file:journal.steps['download_research-dossier'].file,sha256:journal.exports['research-dossier'].exportId}},merchant:{}}}};
    for(const d of ['restored-research','restored-dossiers'])await mkdir(join(out,d),{recursive:true,mode:0o700});
    await retain(receivingConnection,receiving);
    adapter=new MerchantUSASpendingWorkspaces({usaSpendingWorkspaces:await readUSASpendingWorkspaceConfiguration(receivingConnection),exportsDirectory:join(out,'exports')});
    const original=await adapter.call('merchant_usaspending_open',{workspace:'receiving'});
    let status=original,restored;
    if(!status.counts.editions)restored=await call('source_import',{source:'workspace'},'receiving');
    status=await call('status',{},'receiving');check(status.workspaceId===journal.workspaceId,'RESTORED_NATIVE_WORKSPACE_ID_CHANGED');
    const records=await call('rows',{editionId,limit:250},'receiving');check(records.total===rows.length&&canonical(records.rows.map(r=>r.award_key))===canonical(rows.map(r=>r.award_key)),'RESTORED_AWARD_ROWS_CHANGED');
    const current=await call('inventory',{kind:'dossiers'},'receiving');
    const reopened=current.items.length?current.items[0]:await call('source_import',{source:'dossier'},'receiving');
    const dossier=await call('dossier',{dossierId:reopened.id,section:'findings'},'receiving');check(dossier.page.total===3,'RESTORED_DOSSIER_FINDINGS_CHANGED');
    const reviewed=await call('award',{editionId,awardKey:focus.award_key},'receiving');check(reviewed.review?.revision===journal.steps.analyst_review.revision,'RESTORED_ANALYST_REVIEW_CHANGED');
    await call('close',{instanceId:original.instanceId},'receiving');await adapter.close();adapter=null;
    return {workspaceId:status.workspaceId,originalWorkspaceId:journal.workspaceId,rows:records.total,dossierId:reopened.id,findings:dossier.page.total,reviewRevision:reviewed.review.revision,restored};
  });
  journal.status='complete';delete journal.error;journal.completedAt=new Date().toISOString();delete journal.currentStep;await checkpoint();
  process.stdout.write(JSON.stringify({operationId,status:journal.status,workspaceId:journal.workspaceId,sourceRows:rows.length,
    nativePages:delivery.pages,dossierId,findings:3,exports:Object.keys(journal.exports).length,resumedExport:journal.chunkContinuation?.exportId??null,journal:journalPath})+'\n');
}catch(error){journal.status='interrupted';journal.error={code:error.code??'NATIVE_OPERATION_FAILED',message:error.message,stack:error.stack,at:new Date().toISOString()};await checkpoint().catch(()=>{});process.stderr.write(JSON.stringify({operationId,step:journal.currentStep,error:journal.error})+'\n');process.exitCode=1;}
finally{await adapter?.close();}
