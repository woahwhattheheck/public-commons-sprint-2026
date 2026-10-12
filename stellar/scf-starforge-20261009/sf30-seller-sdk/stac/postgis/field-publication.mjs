#!/usr/bin/env node
// Complete accepted-office -> reviewed PostGIS successor -> original QGIS receiving.
// The caller owns no scheduler, field synchronization, credential store or new QGIS engine.
import {readFile,lstat,mkdir} from 'node:fs/promises';
import {resolve,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {need,id,hash,integer,canonical,digest,normalizeProfile} from './contract.mjs';
import {readJSON,regularFile,fileRecord,verifyFile,writeJSONOnce,writeOnce,claimDirectory,
  member,privateDirectory,listFiles,openReceiving} from './files.mjs';
import {openPostgisIntake} from './index.mjs';
import {openBackup} from './backup.mjs';
import {snapshotFromPublication,requirePublicationSnapshot} from './publication-snapshot.mjs';
import {connectionFile} from './cli.mjs';
import {startOperator} from './operator.mjs';
import {verifyReceiving} from './verify.mjs';

const SCHEMA='starforge.postgis-field-publication-programme.v1';
const HERE=dirname(fileURLToPath(import.meta.url));
const SDK=resolve(HERE,'../..');
function absolute(value,label){need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,
  'POSTGIS_FIELD_PROGRAMME_ABSOLUTE_PATH_REQUIRED',label);return value;}
function attribution(value,label){need(typeof value==='string'&&value.trim()&&value.length<=12000,
  'POSTGIS_FIELD_PROGRAMME_ATTRIBUTION_REQUIRED',label);return value;}
async function optionalJSON(path){try{return await readJSON(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function pathWithin(root,path){const rel=relative(root,path);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);}
function keys(value,allowed,label){need(value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every(k=>allowed.includes(k)),'POSTGIS_FIELD_PROGRAMME_UNSUPPORTED_SETTING',label);}
function normalInput(input){
  keys(input,['schema','operationId','connectionFile','profileFile','workspaceDirectory','outputDirectory',
    'deliveryReceivingDirectory','python','actor','note','source','qgis','publication','operations',
    'expectedRevision','expectedEditionId','bindings','promotionDecisions','reader','restore','browser','sourceHead'],'programme');
  need(input?.schema===SCHEMA,'POSTGIS_FIELD_PROGRAMME_REQUIRED');id(input.operationId);
  for(const name of ['connectionFile','profileFile','workspaceDirectory','outputDirectory','deliveryReceivingDirectory','python'])absolute(input[name],name);
  attribution(input.actor,'actor');attribution(input.note,'note');
  need(input.source&&typeof input.source==='object','POSTGIS_FIELD_PROGRAMME_SOURCE_REQUIRED');
  keys(input.source,['workspaceDirectory','workspaceId','fieldProjectId','fieldEditionSha256'],'source');
  absolute(input.source.workspaceDirectory,'source.workspaceDirectory');
  id(input.source.workspaceId);id(input.source.fieldProjectId);hash(input.source.fieldEditionSha256);
  need(input.qgis&&typeof input.qgis==='object','POSTGIS_FIELD_PROGRAMME_QGIS_REQUIRED');
  keys(input.qgis,['python','profileDirectory','workspaceDirectory','receivingDirectory','workspaceId','leftSourceId',
    'expectedRevision','layerIds','decisions','note','title','connection','projectCrs','prefixPath'],'qgis');
  for(const name of ['python','profileDirectory','workspaceDirectory','receivingDirectory'])absolute(input.qgis[name],'qgis.'+name);
  id(input.qgis.workspaceId);hash(input.qgis.leftSourceId);integer(input.qgis.expectedRevision,'qgis.expectedRevision');
  need(Array.isArray(input.qgis.layerIds)&&input.qgis.layerIds.length&&new Set(input.qgis.layerIds).size===input.qgis.layerIds.length,
    'POSTGIS_FIELD_PROGRAMME_QGIS_LAYERS_REQUIRED');
  need(Array.isArray(input.qgis.decisions)&&input.qgis.decisions.length,'POSTGIS_FIELD_PROGRAMME_QGIS_DECISIONS_REQUIRED');
  attribution(input.qgis.note,'qgis.note');attribution(input.qgis.title,'qgis.title');
  need(input.qgis.connection&&typeof input.qgis.connection==='object'&&
    Object.keys(input.qgis.connection).every(k=>['schema','profileId','service','authConfigId','role','sslMode','allowEditing'].includes(k))&&
    input.qgis.connection.allowEditing!==true,'POSTGIS_FIELD_PROGRAMME_READ_CONNECTION_REQUIRED');
  if(input.publication){
    keys(input.publication,['importOperationId','reviewOperationId','stageOperationId','promoteOperationId','reviewSha256'],'publication');
    for(const key of ['importOperationId','reviewOperationId','stageOperationId','promoteOperationId'])id(input.publication[key],key);
    if(input.publication.reviewSha256)hash(input.publication.reviewSha256);
  }else{
    integer(input.expectedRevision,'expectedRevision');id(input.expectedEditionId);
    need(Array.isArray(input.bindings)&&input.bindings.length,'POSTGIS_FIELD_PROGRAMME_BINDINGS_REQUIRED');
    need(Array.isArray(input.promotionDecisions),'POSTGIS_FIELD_PROGRAMME_PUBLICATION_DECISIONS_REQUIRED');
  }
  if(input.operations)for(const [key,value]of Object.entries(input.operations)){
    need(['receiving','backup','restore'].includes(key),'POSTGIS_FIELD_PROGRAMME_OPERATION_KIND_INVALID');id(value);
  }
  if(input.reader){keys(input.reader,['connectionFile','role'],'reader');absolute(input.reader.connectionFile,'reader.connectionFile');attribution(input.reader.role,'reader.role');}
  if(input.restore){keys(input.restore,['connectionFile','profileFile','workspaceDirectory'],'restore');for(const name of ['connectionFile','profileFile','workspaceDirectory'])absolute(input.restore[name],'restore.'+name);}
  if(input.browser){keys(input.browser,['playwrightModule','executablePath'],'browser');absolute(input.browser.playwrightModule,'browser.playwrightModule');absolute(input.browser.executablePath,'browser.executablePath');}
  const roots=[input.outputDirectory,input.workspaceDirectory,input.qgis.profileDirectory,input.qgis.workspaceDirectory,input.qgis.receivingDirectory,input.deliveryReceivingDirectory,
    ...(input.restore?[input.restore.workspaceDirectory]:[])];
  for(let i=0;i<roots.length;i++)for(let j=i+1;j<roots.length;j++)
    need(roots[i]!==roots[j]&&!pathWithin(roots[i],roots[j])&&!pathWithin(roots[j],roots[i]),
      'POSTGIS_FIELD_PROGRAMME_DISTINCT_OUTPUTS_REQUIRED');
  need(input.qgis.profileDirectory!==input.source.workspaceDirectory&&
    !pathWithin(input.qgis.profileDirectory,input.source.workspaceDirectory)&&
    !pathWithin(input.source.workspaceDirectory,input.qgis.profileDirectory),
    'POSTGIS_FIELD_PROGRAMME_EXTERNAL_QGIS_PROFILE_REQUIRED');
  return input;
}
async function child(python,args,{signal,progress}={}){
  signal?.throwIfAborted();
  return new Promise((resolveResult,reject)=>{
    const processChild=spawn(python,args,{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},windowsHide:true});
    let tail='',problem,timer,closed=false,stdout='';
    function send(name){if(closed)return;try{
      if(process.platform!=='win32'&&processChild.pid)process.kill(-processChild.pid,name);else processChild.kill(name);
    }catch(error){if(error.code!=='ESRCH')problem ||= error;}}
    function stop(){problem ||= signal?.reason||new Error('POSTGIS_FIELD_PROGRAMME_INTERRUPTED');send('SIGTERM');
      timer ||= setTimeout(()=>send('SIGKILL'),10000);timer.unref();}
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    processChild.on('error',error=>{problem ||= error;});
    processChild.stdout.on('data',chunk=>{stdout=(stdout+chunk.toString('utf8')).slice(-65536);
      progress?.({phase:'native-child',stream:'stdout',text:chunk.toString('utf8').slice(0,4000)});});
    processChild.stderr.on('data',chunk=>{tail=(tail+chunk.toString('utf8')).slice(-16384);});
    processChild.on('close',(code,exitSignal)=>{
      closed=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);
      if(problem){reject(problem);return;}
      if(code!==0){const error=new Error('The original native receiving child did not complete.');
        error.code='POSTGIS_FIELD_NATIVE_CHILD_INCOMPLETE';error.detail={code,signal:exitSignal,stderr:tail};reject(error);return;}
      resolveResult({exitCode:code,stdout});
    });
  });
}
function assertOriginal(record,kind,projectId){
  need(record?.state==='committed'&&record.executed===false&&record.original?.kind===kind&&
    record.projectId===projectId,'POSTGIS_FIELD_ORIGINAL_OPERATION_CHANGED');
  need(record.artifact?.state!=='unavailable','POSTGIS_COMMITTED_EXPORT_UNAVAILABLE',record.artifact);
  return record.original;
}
async function verifyQgis(output,expected){
  const record=await fileRecord(member(output,'qgis-native-result.json'),'qgis-native-result.json');
  if(expected)need(canonical(record)===canonical(expected),'POSTGIS_FIELD_QGIS_RESULT_CHANGED');
  const result=await readJSON(member(output,record.path));
  need(result.schema==='starforge.postgis-qgis-native-result.v1'&&result.state==='complete'&&
    result.successor?.originalWorkspaceReused===true,'POSTGIS_FIELD_QGIS_SUCCESSOR_REQUIRED');
  const archive=resolve(result.completePackage.path);
  need(archive===member(output,'Starforge_PostGIS_QGIS_Complete_Project.zip'),'POSTGIS_FIELD_QGIS_ARCHIVE_PATH_CHANGED');
  await verifyFile(output,{path:'Starforge_PostGIS_QGIS_Complete_Project.zip',
    bytes:result.completePackage.bytes,sha256:result.completePackage.sha256});
  for(const image of result.images||[])if(image.file)await verifyFile(output,image.file);
  for(const observed of result.nativeObservations||[])await verifyFile(output,observed);
  return {record,result};
}
function sameLayerRows(left,right){
  const select=layers=>layers.map(x=>({id:x.id,rowCount:x.rowCount,rowSha256:x.rowSha256,physicalRelation:x.physicalRelation,
    roles:x.roles.map(r=>({name:r.name,visibleRows:r.visibleRows,visibleRowSha256:r.visibleRowSha256}))})).sort((a,b)=>a.id.localeCompare(b.id));
  return canonical(select(left))===canonical(select(right));
}

export async function runFieldPublication(inputValue,{signal,processSignals=true,progress=()=>{}}={}){
  const input=normalInput(inputValue), controller=new AbortController();
  const stop=()=>controller.abort(signal?.reason||new Error('POSTGIS_FIELD_PROGRAMME_INTERRUPTED'));
  signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  if(processSignals){process.on('SIGINT',stop);process.on('SIGTERM',stop);}
  const active=controller.signal;
  let intake,restored,lockClient,server,browser,page,bodyResult,primary;
  const cleanupErrors=[];
  const check=()=>active.throwIfAborted();
  try{
    check();
    const profile=normalizeProfile(await readJSON(input.profileFile)), profileSha256=digest(profile);
    const toolFiles=[];
    for(const name of ['field-publication.mjs','field_source.py','field_delivery.py','publication-snapshot.mjs','field.mjs','index.mjs','backup.mjs',
      'operator.mjs','operator-browser.mjs','field-browser.mjs','operator.html','operator.css','browser-assets.json',
      'qgis/examples/receive_project.py','FIELD_PUBLICATION.md'])
      toolFiles.push(await fileRecord(member(HERE,name),name));
    const root=await claimDirectory(input.outputDirectory,{schema:SCHEMA,input,profileSha256,toolFiles});
    const programmeSha256=digest({schema:SCHEMA,input,profileSha256,toolFiles});
    const paths={receiving:member(root,'receiving'),backup:member(root,'database-backup'),
      qgis:member(root,'qgis'),phases:member(root,'phases')};
    await privateDirectory(paths.phases);
    const final=await optionalJSON(member(root,'field-publication-result.json'));
    if(final){
      need(final.programmeSha256===programmeSha256&&final.state==='complete','POSTGIS_FIELD_PROGRAMME_RESULT_CHANGED');
      const receiving=await openReceiving(paths.receiving,final.receiving.manifestFile.sha256);
      const backup=await openBackup(paths.backup,final.backup.manifestFile.sha256);
      need(receiving.manifest.editionId===final.publication.editionId&&backup.manifest.editionId===final.publication.editionId,
        'POSTGIS_FIELD_PROGRAMME_PACKAGE_EDITION_CHANGED');
      await verifyQgis(paths.qgis,final.qgis.resultFile);
      for(const item of final.browser?.files||[])await verifyFile(root,item);
      await verifyFile(root,final.package);
      await child(input.python,[member(HERE,'field_delivery.py'),'inspect','--archive',member(root,final.package.path)],{signal:active,progress});
      const received=await readJSON(member(input.deliveryReceivingDirectory,'field-delivery-receipt.json'));
      need(received.archiveSha256===final.package.sha256&&received.operationId===input.operationId,
        'POSTGIS_FIELD_DELIVERY_RECEIPT_CHANGED');
      await child(input.python,[member(HERE,'field_delivery.py'),'receive','--archive',member(root,final.package.path),
        '--destination',input.deliveryReceivingDirectory],{signal:active,progress});
      bodyResult={...final,replayed:true};return bodyResult;
    }
    // A real session advisory lock bounds this one caller in the original database.
    // It does not hold the producer's per-mutation transaction lock.
    const connection=await connectionFile(input.connectionFile);
    lockClient=new pg.Client(connection);
    lockClient.on('error',error=>controller.abort(error));
    await lockClient.connect();check();
    const locked=await lockClient.query("SELECT current_database() AS name,pg_try_advisory_lock(hashtext('starforge.field-publication'),hashtext($1)) AS acquired",
      [input.operationId]);
    need(locked.rows[0].name===profile.database.name&&locked.rows[0].acquired,
      'POSTGIS_FIELD_PROGRAMME_ALREADY_RUNNING_OR_WRONG_DATABASE');
    intake=await openPostgisIntake({connection,profile,directory:input.workspaceDirectory,python:input.python});
    const op=name=>input.operations?.[name]||'field-'+digest([input.operationId,name]).slice(0,48);
    async function probe(operationId){try{return await intake.recoverOperation({operationId});}
      catch(error){if(error.code==='POSTGIS_ORIGINAL_OPERATION_NOT_COMMITTED')return null;throw error;}}
    async function phase(name,method,kind,requestFactory){
      check();const requestPath=member(paths.phases,name+'.request.json'),resultPath=member(paths.phases,name+'.result.json');
      let intent=await optionalJSON(requestPath);
      if(!intent){
        need(!await probe(op(name)),'POSTGIS_FIELD_PHASE_REQUEST_UNAVAILABLE',{phase:name,operationId:op(name)});
        const request=await requestFactory();check();
        intent={schema:'starforge.postgis-field-phase.v1',programmeSha256,method,request:{...request,operationId:op(name)}};
        await writeJSONOnce(requestPath,intent);
      }
      need(intent.programmeSha256===programmeSha256&&intent.method===method&&intent.request.operationId===op(name),
        'POSTGIS_FIELD_PHASE_REQUEST_CHANGED',name);
      const prior=await optionalJSON(resultPath);
      const found=await probe(op(name));
      if(prior){
        need(found,'POSTGIS_FIELD_COMMITTED_PHASE_MISSING',name);
        const original=assertOriginal(found,kind,profile.projectId);
        need(canonical(original)===canonical(prior.original),'POSTGIS_FIELD_PHASE_ORIGINAL_CHANGED',name);
        return original;
      }
      // The original core replays its committed request before checking a changed revision.
      await intake[method](intent.request);
      const original=assertOriginal(await intake.recoverOperation({operationId:op(name)}),kind,profile.projectId);
      await writeJSONOnce(resultPath,{schema:'starforge.postgis-field-phase-result.v1',programmeSha256,original});
      progress({phase:name,state:'committed',operationId:original.operationId});
      check();return original;
    }
    async function adopt(name,operationId,kind){
      check();const original=assertOriginal(await intake.recoverOperation({operationId}),kind,profile.projectId);
      await writeJSONOnce(member(paths.phases,name+'.adopted.json'),
        {schema:'starforge.postgis-field-adopted-operation.v1',programmeSha256,original,executed:false});
      return original;
    }
    let imported,reviewed,staged,published;
    if(input.publication){
      imported=await adopt('import',input.publication.importOperationId,'field-import');
      reviewed=await adopt('review',input.publication.reviewOperationId,'field-review');
      staged=await adopt('stage',input.publication.stageOperationId,'stage');
      published=await adopt('promote',input.publication.promoteOperationId,'promote');
    }else{
      const initialPath=member(root,'initial-project.json'), savedInitial=await optionalJSON(initialPath);
      if(!savedInitial){
        const current=await intake.inspect();
        need(current.initialized&&current.projectId===profile.projectId&&current.revision===input.expectedRevision&&
          current.activeEditionId===input.expectedEditionId&&current.profileSha256===profileSha256,
          'POSTGIS_FIELD_PROGRAMME_INITIAL_EDITION_CHANGED');
        await writeJSONOnce(initialPath,{projectId:current.projectId,revision:current.revision,
          activeEditionId:current.activeEditionId,profileSha256:current.profileSha256});
      }else need(savedInitial.projectId===profile.projectId&&savedInitial.revision===input.expectedRevision&&
        savedInitial.activeEditionId===input.expectedEditionId&&savedInitial.profileSha256===profileSha256,
        'POSTGIS_FIELD_PROGRAMME_INITIAL_IDENTITY_CHANGED');
      imported=await phase('import','importField','field-import',async()=>({...input.source,actor:input.actor,note:input.note}));
      reviewed=await phase('review','saveFieldReview','field-review',async()=>{
        const request={sourceOperationId:imported.operationId,expectedRevision:input.expectedRevision,
          bindings:input.bindings,actor:input.actor,note:input.note};
        const preview=await intake.previewField(request);
        return {...request,reviewSha256:preview.reviewSha256};
      });
      staged=await phase('stage','stageField','stage',async()=>({reviewOperationId:reviewed.operationId}));
      published=await phase('promote','promote','promote',async()=>{
        const review=await intake.review({editionId:staged.result.editionId});
        need(review.expectedRevision===input.expectedRevision,'POSTGIS_FIELD_PROGRAMME_PUBLICATION_REVISION_CHANGED');
        return {editionId:staged.result.editionId,expectedRevision:review.expectedRevision,
          reviewSha256:review.reviewSha256,decisions:input.promotionDecisions};
      });
    }
    const source=imported.request;
    for(const key of ['workspaceDirectory','workspaceId','fieldProjectId','fieldEditionSha256'])
      need(source[key]===input.source[key],'POSTGIS_FIELD_PROGRAMME_SOURCE_BINDING_CHANGED',key);
    need(reviewed.request.input.sourceOperationId===imported.operationId&&
      staged.request.fieldReviewOperationId===reviewed.operationId&&
      published.request.editionId===staged.result.editionId&&
      published.result.fieldCorrection?.reviewOperationId===reviewed.operationId&&
      published.result.fieldCorrection.sourceOperationId===imported.operationId&&
      published.result.fieldCorrection.fieldEditionSha256===input.source.fieldEditionSha256,
      'POSTGIS_FIELD_PROGRAMME_ORIGINAL_CHAIN_CHANGED');
    if(input.publication?.reviewSha256)need(reviewed.result.review.reviewSha256===input.publication.reviewSha256,
      'POSTGIS_FIELD_PROGRAMME_REVIEW_CHANGED');
    await intake.readField({sourceOperationId:imported.operationId,offset:0,limit:1});
    async function exactPublicationBeforeExport(){
      const now=await intake.inspect();
      need(now.activeEditionId===published.result.editionId&&now.revision===published.result.revision&&
        sameLayerRows(now.layers,published.result.layers),'POSTGIS_FIELD_PROGRAMME_PUBLISHED_ROWS_CHANGED');
    }
    const receivingOp=await phase('receiving','exportReceiving','export-receiving',async()=>{
      await exactPublicationBeforeExport();return {directory:paths.receiving,expectedPublication:snapshotFromPublication(published.result)};
    });
    const receiving=await openReceiving(paths.receiving,receivingOp.result.manifestFile.sha256);
    need(receiving.manifest.editionId===published.result.editionId&&receiving.manifest.revision===published.result.revision&&
      sameLayerRows(receiving.manifest.layers,published.result.layers)&&receiving.manifest.fieldEvidence,
      'POSTGIS_FIELD_PROGRAMME_RECEIVING_CHANGED');
    const evidence=await readJSON(member(paths.receiving,receiving.manifest.fieldEvidence.path));
    need(evidence.items.some(x=>x.promotion.operationId===published.operationId&&
      x.review.requestSha256===reviewed.requestSha256&&x.sourceImport.operationId===imported.operationId),
      'POSTGIS_FIELD_PROGRAMME_RECEIVING_EVIDENCE_MISSING');
    const backupOp=await phase('backup','exportBackup','export-backup',async()=>{
      await exactPublicationBeforeExport();return {directory:paths.backup,expectedPublication:snapshotFromPublication(published.result)};
    });
    const backup=await openBackup(paths.backup,backupOp.result.manifestFile.sha256);
    requirePublicationSnapshot({editionId:backup.manifest.editionId,revision:backup.manifest.revision,
      layers:backup.metadata.currentLayerObservations},snapshotFromPublication(published.result));
    need(backup.manifest.editionId===published.result.editionId&&backup.manifest.revision===published.result.revision&&
      backup.manifest.fieldSources?.some(x=>x.operationId===imported.operationId),
      'POSTGIS_FIELD_PROGRAMME_BACKUP_CHANGED');
    let readerResult=null;
    if(input.reader){
      check();const name=member(root,'reader-result.json');
      readerResult=await optionalJSON(name);
      if(!readerResult){readerResult=await verifyReceiving({connection:await connectionFile(input.reader.connectionFile),
        directory:paths.receiving,expectedManifestSha256:receiving.manifestFile.sha256,role:input.reader.role,
        requireUnchangedRows:true,signal:active});await writeJSONOnce(name,readerResult);}
    }
    let restoredResult=null;
    if(input.restore){
      check();const restoreProfile=normalizeProfile(await readJSON(input.restore.profileFile));
      need(restoreProfile.projectId===profile.projectId&&
        canonical(restoreProfile.database)!==canonical(profile.database),'POSTGIS_FIELD_RESTORE_DISTINCT_DESTINATION_REQUIRED');
      restored=await openPostgisIntake({connection:await connectionFile(input.restore.connectionFile),profile:restoreProfile,
        directory:input.restore.workspaceDirectory,python:input.python});
      const request={operationId:op('restore'),directory:paths.backup,expectedManifestSha256:backup.manifestFile.sha256};
      await writeJSONOnce(member(paths.phases,'restore.request.json'),{programmeSha256,request,profile:restoreProfile});
      const value=await restored.restoreBackup(request);
      const replay=await restored.recoverOperation({operationId:published.operationId});
      need(replay.executed===false&&canonical(replay.original)===canonical(published),'POSTGIS_FIELD_RESTORED_ORIGINAL_CHANGED');
      const field=await restored.readField({sourceOperationId:imported.operationId,offset:0,limit:1});
      need(field.manifestFile.sha256===imported.result.fieldSource.manifest.sha256,'POSTGIS_FIELD_RESTORED_SOURCE_CHANGED');
      restoredResult={result:value,originalPublication:replay,originalField:field.manifestFile,solverOrFieldRun:false};
      const prior=await optionalJSON(member(root,'restored-result.json'));
      if(prior){need(canonical(prior.originalPublication.original)===canonical(replay.original)&&
          prior.originalField.sha256===field.manifestFile.sha256,'POSTGIS_FIELD_RESTORE_READBACK_CHANGED');restoredResult=prior;}
      else await writeJSONOnce(member(root,'restored-result.json'),restoredResult);
    }
    check();await privateDirectory(paths.qgis);
    const qgisHandoff={schema:'starforge.postgis-qgis-native-handoff.v1',operationId:op('qgis'),
      sourceHead:input.sourceHead,applicationDirectory:SDK,sourceDirectory:paths.receiving,
      expectedManifestSha256:receiving.manifestFile.sha256,workspaceDirectory:input.qgis.workspaceDirectory,
      receivingDirectory:input.qgis.receivingDirectory,outputDirectory:paths.qgis,
      qgisProfileDirectory:input.qgis.profileDirectory,actor:input.actor,title:input.qgis.title,
      layerIds:input.qgis.layerIds,connection:input.qgis.connection,requireUnchangedRows:true,
      projectCrs:input.qgis.projectCrs||null,
      successor:{workspaceId:input.qgis.workspaceId,expectedRevision:input.qgis.expectedRevision,
        leftSourceId:input.qgis.leftSourceId,decisions:input.qgis.decisions,note:input.qgis.note}};
    const handoffPath=member(paths.qgis,'handoff.json');await writeJSONOnce(handoffPath,qgisHandoff);
    let qgis;
    if(await optionalJSON(member(paths.qgis,'qgis-native-result.json')))qgis=await verifyQgis(paths.qgis);
    else{
      const args=['-B',member(HERE,'qgis/examples/receive_project.py'),'--handoff',handoffPath];
      if(input.qgis.prefixPath)args.push('--qgis-prefix',input.qgis.prefixPath);
      await child(input.qgis.python,args,{signal:active,progress});qgis=await verifyQgis(paths.qgis);
    }
    need(qgis.result.sourceId===receiving.manifestFile.sha256&&qgis.result.successor.originalWorkspaceId===input.qgis.workspaceId&&
      qgis.result.successor.leftSourceId===input.qgis.leftSourceId&&qgis.result.operationId===op('qgis'),
      'POSTGIS_FIELD_PROGRAMME_QGIS_BINDING_CHANGED');
    let browserResult=null;
    if(input.browser){
      check();const saved=await optionalJSON(member(root,'operator-result.json'));
      if(saved){for(const file of saved.files)await verifyFile(root,file);browserResult=saved;}
      else{
        const before=await intake.operationHistory({limit:1});
        server=await startOperator({connection,profile,directory:input.workspaceDirectory,python:input.python,port:0,handleSignals:false});
        const module=await import(pathToFileURL(input.browser.playwrightModule).href);
        const chromium=module.chromium||module.default?.chromium;
        need(chromium,'POSTGIS_FIELD_PLAYWRIGHT_MODULE_REQUIRED');
        browser=await chromium.launch({executablePath:input.browser.executablePath,headless:true});
        page=await browser.newPage({viewport:{width:1440,height:1000}});
        await page.goto(server.url,{waitUntil:'networkidle'});
        await page.locator('#project-label').filter({hasText:profile.projectId}).waitFor();
        await page.locator('[data-show="field"]').click();
        await page.locator('#field-source-operation').fill(imported.operationId);
        await page.locator('#field-open-form button[type="submit"]').click();
        await page.locator('#field-facts').filter({hasText:input.source.fieldEditionSha256}).waitFor();
        await page.locator('#field-changes tr[data-field-change]').first().waitFor();
        const screenshot=member(root,'field-operator.png');await page.screenshot({path:screenshot,fullPage:true});
        await page.locator('[data-show="history"]').click();
        await page.locator('#operation-recovery-id').fill(published.operationId);
        await page.locator('#operation-recovery-form button[type="submit"]').click();
        await page.locator('#committed-recovery-status').filter({hasText:'Original result recovered. No operation was executed.'}).waitFor();
        need((await page.locator('#recovered-original-result').innerText()).includes(reviewed.operationId),
          'POSTGIS_FIELD_OPERATOR_RECOVERY_CHANGED');
        const screenshot2=member(root,'field-publication-recovered.png');await page.screenshot({path:screenshot2,fullPage:true});
        const after=await intake.operationHistory({limit:1});
        need(before.total===after.total&&before.revision===after.revision,'POSTGIS_FIELD_READ_ONLY_OPERATOR_MUTATION');
        browserResult={schema:'starforge.postgis-field-operator-observation.v1',projectId:profile.projectId,
          publicationOperationId:published.operationId,sourceOperationId:imported.operationId,
          reviewOperationId:reviewed.operationId,revision:after.revision,noOperationExecuted:true,
          files:[await fileRecord(screenshot,'field-operator.png'),await fileRecord(screenshot2,'field-publication-recovered.png')]};
        await writeJSONOnce(member(root,'operator-result.json'),browserResult);
      }
    }
    check();
    await writeOnce(member(root,'FIELD_PUBLICATION.md'),await readFile(member(HERE,'FIELD_PUBLICATION.md')));
    const operations={import:imported,review:reviewed,stage:staged,promote:published,receiving:receivingOp,backup:backupOp};
    await writeJSONOnce(member(root,'original-operations.json'),operations);
    const selectedFiles=[];
    for(const directory of ['receiving','database-backup','qgis','phases'])
      for(const row of await listFiles(member(root,directory)))
        if(!row.path.endsWith('.lock')&&!row.path.split('/').some(x=>x.includes('.receiving-')||x.endsWith('.tmp')))
          selectedFiles.push({...row,path:directory+'/'+row.path});
    for(const name of ['request.json','FIELD_PUBLICATION.md','original-operations.json','initial-project.json',
      'reader-result.json','restored-result.json','operator-result.json','field-operator.png','field-publication-recovered.png']){
      try{selectedFiles.push(await fileRecord(member(root,name),name));}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    selectedFiles.sort((a,b)=>a.path.localeCompare(b.path));
    const delivery={schema:'starforge.postgis-field-delivery.v1',programmeSha256,operationId:input.operationId,
      projectId:profile.projectId,publication:{operationId:published.operationId,editionId:published.result.editionId,
        revision:published.result.revision,requestSha256:published.requestSha256},
      source:{...input.source,sourceOperationId:imported.operationId,reviewOperationId:reviewed.operationId},
      receiving:{directory:'receiving',manifestFile:receiving.manifestFile},
      backup:{directory:'database-backup',manifestFile:backup.manifestFile},
      qgis:{directory:'qgis',resultFile:qgis.record,originalWorkspaceId:input.qgis.workspaceId,
        workspaceRevision:qgis.result.workspaceRevision,projectId:qgis.result.projectId,
        completePackage:{path:'qgis/Starforge_PostGIS_QGIS_Complete_Project.zip',
          bytes:qgis.result.completePackage.bytes,sha256:qgis.result.completePackage.sha256}},
      browser:browserResult,readerObserved:!!readerResult,independentDatabaseRestored:!!restoredResult,
      software:{sourceHead:input.sourceHead||null,files:toolFiles,installationRequired:true},
      files:selectedFiles,credentialsIncluded:false,
      receivingInstructions:'Inspect/receive this package with field_delivery.py; use the maintained restore-backup and QGIS receiving commands. No database is restored or native model run automatically.'};
    await writeJSONOnce(member(root,'delivery.json'),delivery);
    const archive=member(root,'Starforge_Field_Successor_Complete_Handover.zip');
    await child(input.python,[member(HERE,'field_delivery.py'),'pack','--directory',root,'--archive',archive],{signal:active,progress});
    await child(input.python,[member(HERE,'field_delivery.py'),'receive','--archive',archive,
      '--destination',input.deliveryReceivingDirectory],{signal:active,progress});
    const deliveryReceipt=await readJSON(member(input.deliveryReceivingDirectory,'field-delivery-receipt.json'));
    need(deliveryReceipt.operationId===input.operationId&&deliveryReceipt.manifestSha256===
      (await fileRecord(member(root,'delivery.json'),'delivery.json')).sha256,'POSTGIS_FIELD_DELIVERY_RECEIPT_CHANGED');
    await openReceiving(member(input.deliveryReceivingDirectory,'receiving'),receiving.manifestFile.sha256);
    await openBackup(member(input.deliveryReceivingDirectory,'database-backup'),backup.manifestFile.sha256);
    bodyResult={schema:'starforge.postgis-field-publication-result.v1',state:'complete',programmeSha256,deliveryReceipt,
      operationId:input.operationId,projectId:profile.projectId,publication:delivery.publication,source:delivery.source,
      receiving:delivery.receiving,backup:delivery.backup,qgis:delivery.qgis,browser:browserResult,
      readerObserved:!!readerResult,independentDatabaseRestored:!!restoredResult,
      package:await fileRecord(archive,'Starforge_Field_Successor_Complete_Handover.zip')};
  }catch(error){primary=error;}
  finally{
    for(const fn of [async()=>{if(browser)await browser.close();},async()=>{if(server)await server.close();},
      async()=>{if(restored)await restored.close();},async()=>{if(intake)await intake.close();},
      async()=>{if(lockClient)await lockClient.end();}]){
      try{await fn();}catch(error){cleanupErrors.push(error);}
    }
    signal?.removeEventListener('abort',stop);
    if(processSignals){process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  }
  if(primary)throw primary;
  need(cleanupErrors.length===0,'POSTGIS_FIELD_PROGRAMME_CLEANUP_INCOMPLETE',cleanupErrors.map(e=>e.code||e.name));
  active.throwIfAborted();
  if(!bodyResult.replayed)await writeJSONOnce(member(input.outputDirectory,'field-publication-result.json'),bodyResult);
  return bodyResult;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    need(process.argv.length===4&&process.argv[2]==='--input','POSTGIS_FIELD_PROGRAMME_USAGE',
      'node stac/postgis/field-publication.mjs --input /absolute/original-programme.json');
    const result=await runFieldPublication(await readJSON(absolute(process.argv[3],'input')),
      {progress:event=>process.stdout.write(canonical(event)+'\n')});
    process.stdout.write(canonical(result)+'\n');
  }catch(error){
    process.stderr.write(canonical({state:'incomplete',code:error.code||'POSTGIS_FIELD_PROGRAMME_FAILED',
      message:error.code?.startsWith('POSTGIS_')?error.message:'The original native continuation did not complete.',
      operationId:error.operationId})+'\n');process.exitCode=1;
  }
}
