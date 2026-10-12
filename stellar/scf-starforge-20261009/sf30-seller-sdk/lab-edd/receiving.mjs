// MIT. One complete original-file receiving operation through the maintained sealed-input worker.
import { createReadStream } from 'node:fs';
import { readFile, open, realpath, mkdir, stat } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { readJobMerchant, validateJobInput } from '../jobs/config.mjs';
import { openInputStore } from '../jobs/inputs/store.mjs';
import { CHUNK_BYTES, FILE_SCHEMA, PLAN_SCHEMA } from '../jobs/inputs/protocol.mjs';
import { privateDirectory, readPrivateJson, writePrivateJson } from '../jobs/inputs/files.mjs';
import { executeJob } from '../jobs/execution.mjs';
import { writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { inspectDelivery, normalizeDecisions, previewDelivery, renderPreparedFiles, compareDeliveries, canonicalJson, sha256 } from './model.mjs';
import { labProfile } from './profiles.mjs';
import { sourceMembers, readLabDecisions } from './application.mjs';
import { reviewTable, parseReviewTable } from './decisions.mjs';
import { readLabResult } from './result.mjs';
import { receiveLabProcessOwnership } from './receiving-processes.mjs';
import { reconcileDeliveries, normalizeReconciliation, previewReconciliation } from './reconciliation.mjs';
import { parseReconciliationTable } from './reconciliation-table.mjs';
import { readReconciliationDecisions } from './reconciliation-application.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const SCHEMA='starforge.lab-edd-native-receiving.v1';
const json=value=>JSON.stringify(value,null,2)+'\n';
const equal=(a,b,message)=>{if(canonicalJson(a)!==canonicalJson(b))throw Error(message);};
const fileTypes={zip:'application/zip',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:'application/vnd.ms-excel',json:'application/json',csv:'text/csv',tsv:'text/tab-separated-values',txt:'text/plain'};
function contentType(path){return fileTypes[path.split('.').at(-1).toLowerCase()]??'application/octet-stream';}
async function metadata(path){
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path,{highWaterMark:CHUNK_BYTES})){digest.update(chunk);bytes+=chunk.length;}
  return {bytes,sha256:digest.digest('hex')};
}
async function existing(path){try{return await readPrivateJson(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function immutable(path,body){
  await privateDirectory(dirname(path));
  try{await writeBytes(path,body,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;equal(await metadata(path),{bytes:body.length,sha256:sha256(body)},'A retained receiving output differs: '+path);}
}
async function stageFile(store,definition,origin,reference,slot,path,token,signal){
  const fileBytes=await metadata(path),chunks=[];
  for await(const body of createReadStream(path,{highWaterMark:CHUNK_BYTES})){signal.throwIfAborted();chunks.push(sha256(body));}
  const file={schema:FILE_SCHEMA,filename:basename(path),contentType:contentType(path),...fileBytes,policySha256:definition.inputFiles.policySha256};
  const plan={schema:PLAN_SCHEMA,origin,reference,functionId:'laboratoryReview',slot,file,chunkBytes:CHUNK_BYTES,chunks};
  let upload=await store.begin({plan,token});const handle=await open(path,'r');
  try{
    for(const index of upload.missing){
      signal.throwIfAborted();const length=Math.min(CHUNK_BYTES,file.bytes-index*CHUNK_BYTES),body=Buffer.alloc(length);let offset=0;
      while(offset<length){const read=await handle.read(body,offset,length-offset,index*CHUNK_BYTES+offset);if(!read.bytesRead)throw Error('The original upload ended early.');offset+=read.bytesRead;}
      upload=await store.writeChunk({id:upload.id,token,index,body,signal});
    }
  }finally{await handle.close();}
  upload=await store.finish({id:upload.id,token,signal});if(upload.state!=='SEALED')throw Error('The complete original file is not sealed.');
  return {file,id:upload.id,chunks:chunks.length,state:upload.state};
}
async function originalDelivery(path,profile,encoding,signal){
  const bytes=await readFile(path);
  return inspectDelivery(sourceMembers(bytes,{filename:basename(path),contentType:contentType(path)},{signal}),profile,{encoding,signal});
}
function keepDocument(delivery){
  const decisions=[];
  for(const table of delivery.tables){
    const row=table.rows[0];if(!row)continue;
    const field=table.keys.find(key=>row.values[key]!=='')??table.keys[0];
    if(!field)continue;
    decisions.push({recordId:row.recordId,rowSha256:row.rowSha256,field,before:row.values[field],action:'keep',
      reason:'Retain this exact original source value during complete native receiving; the laboratory record and its native interpretation remain unchanged.'});
  }
  return normalizeDecisions(delivery,{schema:'starforge.lab-edd-decisions.v1',sourceSha256:delivery.source.sourceSha256,
    profile:delivery.source.profile,decisions});
}
async function extractResult(result,directory){
  await privateDirectory(directory);const files=[];
  for(const member of result.members){
    const path=join(directory,member.filename);await immutable(path,member.bytes);
    files.push({path:member.filename,bytes:member.bytes.length,sha256:member.sha256});
  }
  return files;
}
async function verifyNative(delivery,document,result,signal,{baseline=false}={}){
  const view=baseline?result.baseline:result,identity=baseline?result.manifest.reconciliation.baseline:result.manifest,prefix=baseline?'baseline/':'';
  const preview=previewDelivery(delivery,document);
  equal(identity.sourceSha256,delivery.source.sourceSha256,'The native worker changed the original source.');
  equal(view.document,document,'The native worker changed the full source-bound decision document.');
  equal(identity.reviewSha256,preview.reviewSha256,'The original native preview and worker review differ.');
  equal(view.review.report,preview.report,'The complete profile observations changed in the worker.');
  let prepared,error;
  try{prepared=await renderPreparedFiles(delivery,preview,{signal});}
  catch(cause){signal.throwIfAborted();error={code:String(cause.code??'NATIVE_PREPARATION'),message:String(cause.message??cause)};}
  if(error){
    equal(view.nativePreparation.status,'REVIEW_REQUIRED','A refused native preparation was reported complete.');
    equal({code:view.nativePreparation.error.code,message:view.nativePreparation.error.message},error,'The native preparation refusal changed.');
  }else{
    equal(view.nativePreparation.status,'PREPARED','The completed native preparation was not delivered.');
    equal(view.prepared.map(file=>({filename:file.filename,bytes:file.bytes.length,sha256:file.sha256})),
      prepared.map(file=>({filename:file.filename,bytes:file.size,sha256:file.sha256})),'The actual native receiving files differ from the source-bound renderer.');
  }
  if(view.nativePreparation.status==='PREPARED'){
    const nativeDelivery=await inspectDelivery(view.prepared.map(file=>({filename:file.filename,bytes:file.bytes})),delivery.profile,
      {encoding:delivery.source.textEncoding??'utf-8',signal});
    const fieldRows=tables=>tables.map(table=>({filename:table.filename,headers:table.headers,keys:table.keys,
      sheetName:table.origin?.sheetName??null,sheetIndex:table.origin?.sheetIndex??null,
      rows:table.rows.map(row=>({rowNumber:row.rowNumber,fields:row.fields}))}));
    equal(fieldRows(nativeDelivery.tables),fieldRows(preview.tables),'The native prepared files changed an original or explicitly selected field value.');
    if(!document.decisions.some(choice=>choice.action!=='keep')){
      equal(view.prepared.map(file=>({filename:file.filename,sha256:file.sha256})),
        delivery.originals.map(file=>({filename:file.filename,sha256:file.sha256})),
        'An unchanged receiving file differs from its complete original bytes.');
    }
  }
  for(const format of ['csv','tsv']){
    const member=result.members.find(file=>file.filename===prefix+'decisions.'+format);
    const reopened=parseReviewTable(delivery,member.bytes.toString('utf8'),{format});
    equal(reopened,document,'The full '+format.toUpperCase()+' decision table changed its source-bound choices.');
  }
  const originalMember=result.members.find(file=>file.filename===result.manifest.originalMembers[baseline?'baseline':'source']);
  const originalDescriptor=result.manifest.sourceFiles.find(file=>file.slot===(baseline?'baseline':'source'));
  const received=await inspectDelivery(sourceMembers(originalMember.bytes,originalDescriptor,{signal}),delivery.profile,
    {encoding:delivery.source.textEncoding??'utf-8',signal});
  equal(received.source,delivery.source,'The independent result receiver changed the original source identity.');
  equal(received.tables,delivery.tables,'The independent result receiver changed an original row or worksheet cell.');
  const same=compareDeliveries(received,delivery);
  if(same.disposition==='COMPLETE'&&(same.counts.added||same.counts.removed||same.counts.changed))
    throw Error('The same delivered original source changed during independent receiving.');
  return {sourceSha256:delivery.source.sourceSha256,reviewSha256:preview.reviewSha256,
    rows:delivery.tables.reduce((n,table)=>n+table.rows.length,0),decisions:document.decisions.length,
    nativePreparation:view.nativePreparation,tableRoundTrips:['csv','tsv'],originalReopened:true,sameDelivery:same.counts??null};
}
function checkedConfig(value,base){
  if(value?.schema!=='starforge.lab-edd-receiving-config.v1'||typeof value.operationId!=='string'||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value.operationId)||!Array.isArray(value.families)||!value.families.length||value.families.length>16)
    throw Error('Use the complete source-pinned laboratory receiving configuration.');
  const seen=new Set();
  if(value.processOwnership!==undefined){
    const selected=value.processOwnership;
    if(!selected||typeof selected!=='object'||typeof selected.family!=='string'||
      !value.families.some(family=>family.name===selected.family&&family.profile==='geotech-dts8d'&&family.sourceKind==='generated software-format fixture')||
      (selected.timeoutMs!==undefined&&(!Number.isSafeInteger(selected.timeoutMs)||selected.timeoutMs<3000||selected.timeoutMs>60000)))
      throw Error('Select a generated DTS format family and its actual native-process receiving timeout.');
  }
  return {...value,merchantFile:resolve(base,value.merchantFile??'merchant.example.json'),
    families:value.families.map(family=>{
      if(typeof family.name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(family.name)||seen.has(family.name)||typeof family.sourceFile!=='string')
        throw Error('Each original input family needs a unique stable name and actual source file.');
      seen.add(family.name);labProfile(family.profile);if(family.baselineProfile)labProfile(family.baselineProfile);
      if((family.baselineProfile||family.baselineDecisionsFile||family.reconciliationFile)&&!family.baselineFile)throw Error('The cross-profile family needs its complete original baseline file.');
      return {...family,sourceFile:resolve(base,family.sourceFile),
        ...(family.baselineFile?{baselineFile:resolve(base,family.baselineFile)}:{}),
        ...(family.decisionsFile?{decisionsFile:resolve(base,family.decisionsFile)}:{}),
        ...(family.baselineDecisionsFile?{baselineDecisionsFile:resolve(base,family.baselineDecisionsFile)}:{}),
        ...(family.reconciliationFile?{reconciliationFile:resolve(base,family.reconciliationFile)}:{})};
    })};
}
/** Native execution uses original sealed files and executeJob; each retained family resumes its same identity. */
export async function receiveLabJobs({configuration,directory,scratch,phase='all',signal=new AbortController().signal}={}){
  if(!['native','browser','all'].includes(phase))throw Error('Select native, browser or all receiving phases.');
  configuration=await realpath(resolve(configuration));const configBytes=await readFile(configuration),config=checkedConfig(JSON.parse(configBytes),dirname(configuration));
  directory=resolve(directory);scratch=resolve(scratch);await privateDirectory(directory);await privateDirectory(scratch);
  directory=await realpath(directory);scratch=await realpath(scratch);
  const lease=await acquireStateLease(directory),checkpointPath=join(directory,'receiving.json');
  const save=checkpoint=>writePrivateJson(checkpointPath,checkpoint,()=>lease.assertHeld());
  let store;
  try{
    const merchant=await readJobMerchant(config.merchantFile),definition=merchant.compiled.functions.laboratoryReview;
    if(!definition?.inputFiles)throw Error('Select the original laboratory function and declared file-slot policy.');
    const binding={configurationSha256:sha256(configBytes),applicationSha256:merchant.identity.applicationSha256,
      merchantSha256:merchant.identity.configSha256,operationId:config.operationId};
    let checkpoint=await existing(checkpointPath);
    if(checkpoint)equal(checkpoint.binding,binding,'The retained receiving operation belongs to a different source configuration.');
    else{
      if(phase==='browser')throw Error('Complete the same original native receiving phase first.');
      checkpoint={schema:SCHEMA,binding,createdAt:new Date().toISOString(),families:{}};await save(checkpoint);
    }
    if(phase!=='browser'){
      store=await openInputStore({directory:join(directory,'inputs'),lease,limits:merchant.compiled.inputFileStorage});
      for(const family of config.families){
        signal.throwIfAborted();const source=await realpath(family.sourceFile),profile=labProfile(family.profile),encoding=family.encoding??'utf-8';
        const sourceFile=await metadata(source);
        if(family.sourceSha256&&family.sourceSha256!==sourceFile.sha256)throw Error('The original source receipt changed: '+family.name);
        if(family.sourceBytes!==undefined&&family.sourceBytes!==sourceFile.bytes)throw Error('The original source length changed: '+family.name);
        const familyRoot=join(directory,family.name);await privateDirectory(familyRoot);
        const delivery=await originalDelivery(source,profile,encoding,signal);
        const baseline=family.baselineFile?await originalDelivery(family.baselineFile,labProfile(family.baselineProfile??family.profile),family.baselineEncoding??encoding,signal):null;
        const cross=baseline&&baseline.source.profile.id!==delivery.source.profile.id?reconcileDeliveries(delivery,baseline):null;
        if((family.baselineDecisionsFile||family.reconciliationFile)&&!cross)throw Error('Select the different-profile original baseline for cross-profile receiving.');
        const sourceBinding={...sourceFile,sourceSha256:delivery.source.sourceSha256,profile:delivery.source.profile,
          ...(family.baselineFile?{baseline:{...await metadata(family.baselineFile),sourceSha256:baseline.source.sourceSha256,profile:baseline.source.profile}}:{})};
        let state=checkpoint.families[family.name];
        if(state)equal(state.source,sourceBinding,'The retained native family belongs to different original files.');
        else{state=checkpoint.families[family.name]={source:sourceBinding,iterations:{}};await save(checkpoint);}
        const document=family.decisionsFile?readLabDecisions(delivery,await readFile(family.decisionsFile),
          {filename:basename(family.decisionsFile),contentType:contentType(family.decisionsFile)},family.decisionFormat):keepDocument(delivery);
        const decisionsPath=join(familyRoot,'reviewed-decisions.json');await immutable(decisionsPath,Buffer.from(json(document)));
        const baselineDocument=cross?(family.baselineDecisionsFile?readLabDecisions(baseline,await readFile(family.baselineDecisionsFile),
          {filename:basename(family.baselineDecisionsFile)},family.baselineDecisionFormat):keepDocument(baseline)):null;
        const correspondence=cross?(family.reconciliationFile?readReconciliationDecisions(cross,await readFile(family.reconciliationFile),
          {filename:basename(family.reconciliationFile)},{format:family.reconciliationFormat}):normalizeReconciliation(cross)):null;
        const baselineDecisionsPath=join(familyRoot,'reviewed-baseline-decisions.json'),correspondencePath=join(familyRoot,'reviewed-reconciliation.json');
        if(cross){await immutable(baselineDecisionsPath,Buffer.from(json(baselineDocument)));await immutable(correspondencePath,Buffer.from(json(correspondence)));}
        const tableResults={};
        for(const format of ['csv','tsv']){
          const table=reviewTable(delivery,document,{format,scope:family.tableScope??'issues',fields:family.tableFields});
          equal(parseReviewTable(delivery,table.text,{format}),document,'The full editable '+format+' table did not retain its original decisions.');
          const path=join(familyRoot,'reviewed-decisions.'+format);await immutable(path,Buffer.from(table.text));
          tableResults[format]={path,bytes:Buffer.byteLength(table.text),sha256:sha256(table.text),rows:table.rows};
        }
        state.decisionDocumentSha256=sha256(canonicalJson(document));state.tables=tableResults;await save(checkpoint);
        for(const name of ['initial','reviewed']){
          signal.throwIfAborted();
          let iteration=state.iterations[name];
          if(!iteration){iteration=state.iterations[name]={reference:'lab-'+sha256(config.operationId+':'+family.name+':'+name).slice(0,32),
            token:randomBytes(32).toString('base64url')};await save(checkpoint);}
          const selectedDocument=name==='initial'?normalizeDecisions(delivery):document;
          const uploads={source:await stageFile(store,definition,merchant.compiled.publicOrigin,iteration.reference,'source',source,iteration.token,signal)};
          if(family.baselineFile)uploads.baseline=await stageFile(store,definition,merchant.compiled.publicOrigin,iteration.reference,'baseline',family.baselineFile,iteration.token,signal);
          if(name==='reviewed')uploads.decisions=await stageFile(store,definition,merchant.compiled.publicOrigin,iteration.reference,'decisions',decisionsPath,iteration.token,signal);
          if(name==='reviewed'&&cross){
            uploads.baseline_decisions=await stageFile(store,definition,merchant.compiled.publicOrigin,iteration.reference,'baseline_decisions',baselineDecisionsPath,iteration.token,signal);
            uploads.reconciliation=await stageFile(store,definition,merchant.compiled.publicOrigin,iteration.reference,'reconciliation',correspondencePath,iteration.token,signal);
          }
          const input={profile:profile.id,reviewName:family.name+'-'+name,encoding,expectedSourceSha256:delivery.source.sourceSha256,
            tableScope:family.tableScope??'issues',...(family.tableFields?{tableFields:family.tableFields}:{}),
            ...(baseline?{baselineProfile:baseline.source.profile.id,baselineEncoding:family.baselineEncoding??encoding,expectedBaselineSha256:baseline.source.sourceSha256}:{}),
            $files:Object.fromEntries(Object.entries(uploads).map(([slot,value])=>[slot,value.file]))};
          const canonical=validateJobInput(definition,input);
          await store.pinJob({origin:merchant.compiled.publicOrigin,reference:iteration.reference,functionId:'laboratoryReview',
            ...canonical,policy:definition.inputFiles,token:iteration.token,signal});
          const row={id:iteration.reference,functionId:'laboratoryReview',...canonical};
          if(iteration.inputSha256)equal(iteration.inputSha256,canonical.inputSha256,'The same native request changed.');
          iteration.inputSha256=canonical.inputSha256;iteration.uploads=uploads;await save(checkpoint);
          const outputPath=join(familyRoot,name+'-laboratory-result.zip');
          let output;
          try{output=await readFile(outputPath);}catch(error){if(error.code!=='ENOENT')throw error;}
          if(!output){
            output=await executeJob(merchant,row,{id:'lab-native-1'},{env:{...process.env,LAB_EDD_TEMP_ROOT:scratch,SF30_JOB_TEMP:scratch,LAB_EDD_PYTHON:process.env.LAB_EDD_PYTHON||'python3'},signal,inputDirectory:join(directory,'inputs')});
            await immutable(outputPath,output);
          }
          const result=readLabResult(output,{signal});
          equal(result.manifest.jobId,row.id,'The retained worker result belongs to a different original job.');
          equal(result.manifest.request,Object.fromEntries(Object.entries(input).filter(([key])=>key!=='$files')),'The retained worker result belongs to a different request.');
          const identity={path:outputPath,bytes:output.length,sha256:sha256(output)};
          if(iteration.output)equal(iteration.output,identity,'The retained native result changed.');
          iteration.output=identity;await save(checkpoint);
          if(name==='reviewed'&&!iteration.replay){
            const replay=await executeJob(merchant,row,{id:'lab-native-2'},{env:{...process.env,LAB_EDD_TEMP_ROOT:scratch,SF30_JOB_TEMP:scratch,LAB_EDD_PYTHON:process.env.LAB_EDD_PYTHON||'python3'},signal,inputDirectory:join(directory,'inputs')});
            equal({bytes:replay.length,sha256:sha256(replay)},{bytes:identity.bytes,sha256:identity.sha256},'The same original worker request changed on replay.');
            iteration.replay={sameReference:row.id,sameInputSha256:row.inputSha256,bytes:replay.length,sha256:sha256(replay)};await save(checkpoint);
          }
          iteration.receiving=await verifyNative(delivery,selectedDocument,result,signal);
          if(cross){
            const selectedBaseline=name==='initial'?normalizeDecisions(baseline):baselineDocument;
            const selectedCorrespondence=name==='initial'?normalizeReconciliation(cross):correspondence;
            const expectedReview=previewReconciliation(cross,selectedCorrespondence);
            equal(result.reconciliation.comparison,cross,'The complete original source-pair comparison changed in the worker.');
            equal(result.reconciliation.review,expectedReview,'The full source-bound correspondence review changed in the worker.');
            for(const format of ['csv','tsv']){
              const member=result.members.find(file=>file.filename==='reconciliation/decisions.'+format);
              equal(parseReconciliationTable(cross,member.bytes.toString('utf8'),{format}),selectedCorrespondence,'The complete correspondence table changed: '+format);
            }
            iteration.crossProfile={comparisonSha256:cross.comparisonSha256,documentSha256:expectedReview.documentSha256,
              reviewSha256:expectedReview.reviewSha256,counts:cross.counts,byKind:cross.byKind,correspondence:expectedReview.counts,
              baseline:await verifyNative(baseline,selectedBaseline,result,signal,{baseline:true}),tableRoundTrips:['csv','tsv']};
          }
          iteration.extractedDirectory=join(familyRoot,name+'-received');
          iteration.files=await extractResult(result,iteration.extractedDirectory);
          iteration.manifest=result.manifest;iteration.completedAt??=new Date().toISOString();await save(checkpoint);
          process.stdout.write(json({family:family.name,iteration:name,output:identity,receiving:iteration.receiving}));
        }
        state.completedAt??=new Date().toISOString();await save(checkpoint);global.gc?.();
      }
      if(config.processOwnership&&!checkpoint.processOwnership){
        const family=config.families.find(row=>row.name===config.processOwnership.family);
        const source=await realpath(family.sourceFile);
        checkpoint.processOwnership=await receiveLabProcessOwnership({
          directory:join(directory,'native-process-receiving'),scratch:join(scratch,'native-process-receiving'),
          merchant,store,inputDirectory:join(directory,'inputs'),source,sourceBinding:checkpoint.families[family.name].source,
          operationId:config.operationId,lease,signal,timeoutMs:config.processOwnership.timeoutMs??15000,
          stageSource:(reference,token,path)=>stageFile(store,definition,merchant.compiled.publicOrigin,reference,'source',path,token,signal)
        });await save(checkpoint);
      }
      checkpoint.nativeCompletedAt??=new Date().toISOString();await save(checkpoint);
    }
    if(phase!=='native'){
      if(!checkpoint.nativeCompletedAt)throw Error('Complete the same original native receiving families before browser receiving.');
      const {receiveLabBrowser}=await import('./receiving-browser.mjs');
      if(!checkpoint.browser){
        checkpoint.browser=await receiveLabBrowser({directory,configuration:config.browser,families:checkpoint.families,signal});
        await save(checkpoint);
      }
    }
    const result={schema:SCHEMA,operationId:config.operationId,binding,
      nativeCompletedAt:checkpoint.nativeCompletedAt??null,browser:checkpoint.browser??null,processOwnership:checkpoint.processOwnership??null,
      status:checkpoint.nativeCompletedAt&&checkpoint.browser?'COMPLETE':'NATIVE_COMPLETE',
      families:Object.fromEntries(Object.entries(checkpoint.families).map(([name,state])=>[name,{
        source:state.source,sourceKind:config.families.find(row=>row.name===name).sourceKind??'operator-supplied delivery',decisionDocumentSha256:state.decisionDocumentSha256,tables:state.tables,
        iterations:Object.fromEntries(Object.entries(state.iterations).map(([id,value])=>{
          const {token,...publicValue}=value;return [id,publicValue];
        })),completedAt:state.completedAt}]))};
    await writePrivateJson(join(directory,'result.json'),result,()=>lease.assertHeld());return result;
  }finally{try{await store?.close();}finally{await lease.close();}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{configuration:{type:'string'},directory:{type:'string'},scratch:{type:'string'},phase:{type:'string'}}});
  if(!values.configuration||!values.directory||!values.scratch)throw Error('Use --configuration FILE --directory PRIVATE_OUTPUT --scratch PRIVATE_WORKER_TEMP [--phase native|browser|all].');
  const controller=new AbortController();process.once('SIGINT',()=>controller.abort(new Error('Receiving cancelled.')));process.once('SIGTERM',()=>controller.abort(new Error('Receiving cancelled.')));
  receiveLabJobs({...values,signal:controller.signal}).then(result=>process.stdout.write(json({status:result.status,operationId:result.operationId,families:Object.keys(result.families)})))
    .catch(error=>{process.stderr.write(json({error:error.code??error.name,message:error.message,detail:error.detail??error.details}));process.exitCode=1;});
}
