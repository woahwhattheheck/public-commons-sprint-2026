// MIT. Continue one original Baserow capture through merchant MCP and customer receiving.
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lstat, rename } from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { bytes, readJson, readPrivate, createFile, atomicJson, privateDirectory,
  digest, identity, fault, acquireWorkspace } from
  '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import { createOrVerify } from
  '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/packet.mjs';
import { openBaserowAuthoring } from
  '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/model.mjs';
import { serveBaserowAuthoring } from
  '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/server.mjs';
import { readBaserowSourceFile } from
  '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/declaration.mjs';
import { readBaserowCapture } from
  '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/capture.mjs';
import { BaserowNumber, exactJson } from
  '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/values.mjs';
import { datasetExtractionOptions } from
  '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/stream.mjs';
import { initializeBaserowWorkspaceMerchant, readMerchantConfig } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';
import { openMerchantFileClient } from '../retained-download.mjs';
import { downloadBaserowExport, reopenBaserowExport, receiveBaserowSourceExport } from '../baserow-workspace-download.mjs';

const OP='BASEROW-PUBLIC-CATALOG-CAPTURE-0D0B-20261012';
const SCHEMA='stellar-forge.baserow-mcp-customer-journey.v1';
const HELP='Continue the original completed Baserow capture through its actual merchant MCP (Node 24/Linux).\n'+
  '  node examples/baserow-handoff.mjs --native-run ORIGINAL_RUN --out CONTINUATION_DIRECTORY --source-ref FULL_GIT_SHA\n'+
  '       [--terms ORIGINAL_PRIVATE_TERMS.json [--runtime ORIGINAL_PRIVATE_RUNTIME.json]]\n'+
  'Reuses native-result.json, workspace-customer-result.json and their original source workspace/capture.\n'+
  'Retains native request IDs, publication, customer source import and complete download; repeat the same command to resume.\n';
const need=(value,code)=>{if(!value)throw fault(code);};
const exists=async path=>{try{await lstat(path);return true;}catch(issue){if(issue.code==='ENOENT')return false;throw issue;}};
const optional=async path=>await exists(path)?readJson(path,16777216):null;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const typed=value=>value instanceof BaserowNumber?{kind:'number-token',value:value.text}:
  value===null?{kind:'null',value:null}:['string','boolean'].includes(typeof value)
    ?{kind:typeof value,value}:{kind:'structured',value:exactJson(value)};
function optionsFor(argv) {
  const values={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    need(['--native-run','--out','--source-ref','--terms','--runtime'].includes(key)&&
      !Object.hasOwn(values,key)&&argv[i+1]&&!argv[i+1].startsWith('--'),'BASEROW_MCP_EXAMPLE_OPTION_INVALID');
    values[key]=argv[++i];
  }
  need(values['--native-run']&&values['--out']&&/^[a-f0-9]{40}$/.test(values['--source-ref']??'')&&
    (!values['--runtime']||values['--terms']),'BASEROW_MCP_EXAMPLE_OPTIONS_REQUIRED');
  return {nativeRun:resolve(values['--native-run']),directory:resolve(values['--out']),sourceRef:values['--source-ref'],
    termsFile:values['--terms']?resolve(values['--terms']):null,runtimeFile:values['--runtime']?resolve(values['--runtime']):null};
}
async function retain(path,value) {await createOrVerify(path,bytes(value),16777216);return value;}
async function originalRecord(path,make) {
  const prior=await optional(path);if(prior)return prior;
  return retain(path,await make());
}
async function privateUrl(directory,name,url) {
  const next=join(directory,'.'+name+'-'+randomUUID());await createFile(next,Buffer.from(url+'\n'));
  await rename(next,join(directory,name));
}
function planFor(selected,queryName,title) {
  const query=selected.queries[queryName],columns=Object.fromEntries(Object.entries(query.projection)
    .map(([name,spec])=>[name,{type:spec.type,nullable:spec.nullable??false}]));
  const order=Object.keys(columns).includes('record_id')?[{column:'record_id',direction:'asc'}]:[];
  return {title,query:queryName,input:{},sourceHash:selected.hash,
    dataset:{name:title,columns,filters:[],ranges:[],sorts:[],maxCellChars:1048576,
      defaultLimit:50,maxLimit:250,maxPageBytes:921600},
    extraction:{maxRows:100000,maxBytes:67108864,maxRowBytes:8388608,timeoutMs:300000,order}};
}
function sameNativePlan(plan,input,selected) {
  const extraction=datasetExtractionOptions(selected.queries[input.query],input.extraction);
  return plan.data?.sourceHash===input.sourceHash&&plan.data.query===input.query&&plan.data.title===input.title&&
    identity(plan.data.input)===identity(input.input)&&identity(plan.data.extraction)===identity(extraction)&&
    identity(plan.data.dataset)===identity({schema:'stellar-forge.csv-dataset.v1',file:'data.csv',
      ...input.dataset,maxBytes:extraction.maxBytes,maxRows:extraction.maxRows})&&
    identity(plan.data.sourceQuery?.projection)===identity(selected.queries[input.query].projection);
}
async function receiveOffline(options,state,receipt) {
  const selection={directory:join(options.directory,'customer-files'),exportId:state.exportId,
    expectedManifestSha256:receipt.manifestFile.sha256};
  const reopened=await reopenBaserowExport(selection);
  const received=await receiveBaserowSourceExport({...selection,workspace:state.recipientDirectory,create:false,
    title:state.recipientTitle,expectedDraftRevision:0,requestId:state.ids.import});
  need(received.result.capture.manifestSha256===state.captureSha256,'BASEROW_MCP_EXAMPLE_RECEIVING_CHANGED');
  const native=await openBaserowAuthoring({directory:state.recipientDirectory});
  try {
    const current=await native.status(),saved=await native.resume(state.ids.version);
    need(current.selectedVersion===saved.selectedVersion&&saved.version.observationSha256===state.captureSha256&&
      native.operation(state.ids.import).status==='complete','BASEROW_MCP_EXAMPLE_REOPEN_CHANGED');
    return {download:reopened,receiving:received,selectedVersion:saved.selectedVersion,
      sourceSha256:saved.sourceSha256,originalImportRecovered:true};
  }finally{await native.close();}
}

export async function main(argv=process.argv.slice(2)) {
  if(argv.length===1&&['--help','help'].includes(argv[0])){process.stdout.write(HELP);return;}
  const options=optionsFor(argv);
  need(options.directory!==options.nativeRun,'BASEROW_MCP_EXAMPLE_CONTINUATION_DIRECTORY_REQUIRED');
  await privateDirectory(options.nativeRun);await privateDirectory(options.directory,true);
  const release=await acquireWorkspace(options.directory);
  let source,sourceServer,recipient,recipientServer,mcp,client,stage='original-source';
  const closeSource=async()=>{
    if(sourceServer){const active=sourceServer;sourceServer=null;source=null;await active.close();}
    else if(source){const active=source;source=null;await active.close();}
    if(recipientServer){const active=recipientServer;recipientServer=null;recipient=null;await active.close();}
    else if(recipient){const active=recipient;recipient=null;await active.close();}
  };
  const closeMcp=async()=>{if(mcp){const active=mcp;mcp=null;client=null;await active.close();}};
  try {
    const baselineBytes=await readPrivate(join(options.nativeRun,'native-result.json'),16777216);
    const baseline=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(baselineBytes));
    const workspaceBytes=await readPrivate(join(options.nativeRun,'workspace-customer-result.json'),16777216);
    const priorWorkspace=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(workspaceBytes));
    need(baseline.operation===OP&&baseline.state==='COMPLETED'&&priorWorkspace.state==='COMPLETED'&&
      baseline.source.captureSha256===priorWorkspace.originalCaptureSha256&&
      priorWorkspace.source.directory===join(options.nativeRun,'source-workspace'),
      'BASEROW_MCP_EXAMPLE_ORIGINAL_RUN_REQUIRED');
    const terms=options.termsFile?await readJson(options.termsFile,65536):null;
    const runtime=options.runtimeFile?await readJson(options.runtimeFile,65536):{port:0};
    const inputs={nativeRun:options.nativeRun,directory:options.directory,sourceRef:options.sourceRef,
      nativeResultSha256:digest(baselineBytes),workspaceResultSha256:digest(workspaceBytes),
      termsSha256:terms?identity(terms):null,runtimeSha256:terms?identity(runtime):null};
    const statePath=join(options.directory,'journey.json');
    let state=await optional(statePath);
    if(state)need(identity(state.inputs)===identity(inputs),'BASEROW_MCP_EXAMPLE_INPUT_CHANGED');
    const completed=await optional(join(options.directory,'mcp-customer-result.json'));
    if(completed){
      need(state&&completed.state==='COMPLETED'&&completed.export.exportId===state.exportId,
        'BASEROW_MCP_EXAMPLE_RESULT_CHANGED');
      const reopened=await receiveOffline(options,state,completed.export);
      await atomicJson(options.directory,'mcp-customer-reopen.json',{schema:SCHEMA,state:'REOPENED',
        operation:OP,sourceRef:options.sourceRef,originalResult:join(options.directory,'mcp-customer-result.json'),
        at:new Date().toISOString(),...reopened});
      process.stdout.write(JSON.stringify({state:'REOPENED',directory:options.directory,exportId:state.exportId})+'\n');
      return completed;
    }
    source=await openBaserowAuthoring({directory:priorWorkspace.source.directory});
    const originalStatus=await source.status(),version=source.version(priorWorkspace.source.version.versionId);
    const selected=await readBaserowSourceFile(originalStatus.publisher.sourceFile);
    const original=await readBaserowCapture(selected.captureFile,baseline.source.captureSha256);
    need(originalStatus.selectedVersion===version.id&&selected.hash===version.sourceSha256&&
      original.manifestSha256===baseline.source.captureSha256&&original.manifest.rowCount===baseline.source.rows,
      'BASEROW_MCP_EXAMPLE_SOURCE_CHANGED');
    if(!state){
      const queryName=Object.keys(selected.queries)[0];
      need(queryName,'BASEROW_MCP_EXAMPLE_QUERY_REQUIRED');
      const ids=Object.fromEntries(['plan','extract','run','review','publish','recover','import','preview','version',
        'deploymentReview','deploymentPrepare','deploymentStage'].map(name=>[name,randomUUID()]));
      state=await retain(statePath,{schema:SCHEMA,operation:OP,inputs,startedAt:new Date().toISOString(),
        sourceDirectory:source.directory,recipientDirectory:join(options.directory,'recipient-workspace'),
        versionId:version.id,sourceSha256:selected.hash,captureId:version.captureId,captureSha256:original.manifestSha256,
        queryName,recipientTitle:'Received original Baserow MCP source',exportId:randomUUID(),ids,
        plan:planFor(selected,queryName,'Original Baserow source through merchant MCP')});
    }
    need(state.versionId===version.id&&state.sourceSha256===selected.hash&&state.captureId===version.captureId&&
      state.captureSha256===original.manifestSha256,'BASEROW_MCP_EXAMPLE_SOURCE_CHANGED');
    recipient=await openBaserowAuthoring({directory:state.recipientDirectory,create:true});
    sourceServer=await serveBaserowAuthoring({workspace:source,port:0});
    recipientServer=await serveBaserowAuthoring({workspace:recipient,port:0});
    await privateUrl(options.directory,'source.url',sourceServer.url);
    await privateUrl(options.directory,'recipient.url',recipientServer.url);
    const connection={schema:'stellar-forge.baserow-workspace-connection.v1',workspaces:{
      catalog:{label:'Original retained Baserow source',directory:state.sourceDirectory,consoleUrlFile:join(options.directory,'source.url'),
        ...(terms?{terms:{original:terms},runtimes:{original:runtime}}:{})},
      recipient:{label:'Customer receiving workspace',directory:state.recipientDirectory,consoleUrlFile:join(options.directory,'recipient.url')}
    }};
    const connectionFile=join(options.directory,'baserow-workspaces.json');
    await retain(connectionFile,connection);
    const configPath=join(options.directory,'merchant','merchant-mcp.json');
    if(!await exists(configPath))await initializeBaserowWorkspaceMerchant({directory:dirname(configPath),connection:connectionFile});
    const config=await readMerchantConfig(configPath);
    need(config.baserowWorkspaces.workspaces.catalog.directory===state.sourceDirectory&&
      config.baserowWorkspaces.workspaces.recipient.directory===state.recipientDirectory,
      'BASEROW_MCP_EXAMPLE_CONFIGURATION_CHANGED');
    const tokenFile=join(options.directory,'mcp.token');
    if(!await exists(tokenFile))await createFile(tokenFile,Buffer.from(randomBytes(32).toString('hex')+'\n'));
    const token=(await readPrivate(tokenFile,256)).toString('utf8').trim();
    const environment={...process.env,MCP_ACCESS_TOKEN:token,MCP_OAUTH_CONFIG:undefined};
    const portFile=join(options.directory,'mcp-port.json');
    const startMcp=async()=>{
      const saved=await optional(portFile);
      mcp=await startMerchantMcp({configPath,port:saved?.port??0,environment});
      const port=mcp.server.address().port;
      if(saved)need(saved.port===port,'BASEROW_MCP_EXAMPLE_ENDPOINT_CHANGED');
      else await retain(portFile,{port});
      client=await openMerchantFileClient({url:mcp.url+'/mcp',environment,errorPrefix:'BASEROW_FILE',
        clientName:'original-baserow-customer'});
    };
    await startMcp();
    const native=async(name,args)=>{const result=await client.call(name,args);
      need(result.workspace===args.workspace&&result.native!==undefined,'BASEROW_MCP_EXAMPLE_NATIVE_REPLY_REQUIRED');return result.native;};
    // Each input is retained before dispatch. Reuse the original native request after a lost reply.
    const once=async(name,tool,make)=>{
      const input=await originalRecord(join(options.directory,name+'-input.json'),make);
      const resultFile=join(options.directory,name+'-result.json'),saved=await optional(resultFile);
      if(saved)return saved;
      const requestId=input.requestId??input.input?.requestId;
      let result,operation;
      if(requestId)try{operation=await native('merchant_baserow_operation',{workspace:input.workspace,requestId});}
      catch(issue){if(issue.code!=='BASEROW_OPERATION_NOT_FOUND')throw issue;}
      if(operation)result=await native('merchant_baserow_operation',{workspace:input.workspace,requestId,resume:true});
      else result=await native(tool,input);
      return retain(resultFile,result);
    };
    const publishRead=(action,input={})=>native('merchant_baserow_publisher',{workspace:'catalog',action,input});
    const publishWrite=(name,action,input)=>once(name,'merchant_baserow_publisher',async()=>({
      workspace:'catalog',action,input:typeof input==='function'?await input():input,
      expectedSelectedVersion:state.versionId,requestId:state.ids[name]}));
    stage='original-full-source-through-mcp';
    const originalKeys=['$recordId','$order',...original.manifest.selection.fields.map(item=>'field_'+item.id)];
    const rowsHash=createHash('sha256'),filesHash=createHash('sha256');
    let count=0,offset=0,rowsPages=0,fileCount=0,filePages=0;
    do {
      const page=await native('merchant_baserow_capture_read',{workspace:'catalog',id:state.captureId,kind:'rows',
        expectedCaptureSha256:state.captureSha256,offset,limit:100});
      need(page.total===original.records.length&&page.offset===offset&&
        identity(page.fields.map(field=>field.key))===identity(originalKeys),'BASEROW_MCP_EXAMPLE_ROWS_CHANGED');
      for(const row of page.records){
        const record=original.records[count];
        need(record&&row.index===count,'BASEROW_MCP_EXAMPLE_ROWS_CHANGED');
        for(const key of originalKeys){
          const value=key==='$recordId'?record.id:key==='$order'?record.order:record[key];
          need(identity(row.values[key])===identity(typed(value)),'BASEROW_MCP_EXAMPLE_VALUE_CHANGED');
        }
        rowsHash.update(JSON.stringify(row.values)+'\n');count++;
      }
      need(page.nextOffset===(count<page.total?count:null),'BASEROW_MCP_EXAMPLE_ROWS_CHANGED');
      offset=page.nextOffset;rowsPages++;
    }while(offset!==null);
    offset=0;
    do {
      const page=await native('merchant_baserow_capture_read',{workspace:'catalog',id:state.captureId,kind:'files',
        expectedCaptureSha256:state.captureSha256,offset,limit:100});
      need(page.total===original.manifest.attachmentCount&&page.offset===offset,'BASEROW_MCP_EXAMPLE_FILES_CHANGED');
      for(const file of page.files){
        const actual=original.manifest.attachments[fileCount];
        need(actual&&file.file===actual.file&&file.bytes===actual.bytes&&file.sha256===actual.sha256&&
          file.referenceCount===actual.references.length,'BASEROW_MCP_EXAMPLE_FILES_CHANGED');
        filesHash.update(JSON.stringify({file:file.file,bytes:file.bytes,sha256:file.sha256,referenceCount:file.referenceCount})+'\n');
        fileCount++;
      }
      need(page.nextOffset===(fileCount<page.total?fileCount:null),'BASEROW_MCP_EXAMPLE_FILES_CHANGED');
      offset=page.nextOffset;filePages++;
    }while(offset!==null);
    const sourceRead={rows:count,rowsPages,rowsSha256:rowsHash.digest('hex'),files:fileCount,filePages,
      fileIndexSha256:filesHash.digest('hex')};
    await retain(join(options.directory,'source-read-result.json'),sourceRead);
    stage='original-publisher-through-mcp';
    // Reopening a host starts a new intentional service lifetime; saved business commands retain their original IDs.
    const opening=randomUUID();
    await retain(join(options.directory,'publisher-open-'+opening+'.json'),{requestId:opening,sourceVersion:state.versionId});
    await native('merchant_baserow_publisher',{workspace:'catalog',action:'open',expectedSelectedVersion:state.versionId,requestId:opening});
    const savedPlan=await publishWrite('plan','plan-save',{plan:state.plan});
    let plan;
    if(savedPlan.mode==='ORIGINAL_PUBLISHER_RESULT')plan=savedPlan.value;
    else {
      need(savedPlan.mode==='OBSERVED_ORIGINAL_STATE','BASEROW_MCP_EXAMPLE_PLAN_RESULT_INVALID');
      const candidates=(savedPlan.originalPlans??[]).filter(row=>sameNativePlan(row,state.plan,selected)).sort((a,b)=>a.id-b.id);
      need(candidates.length,'BASEROW_MCP_EXAMPLE_MATCHING_NATIVE_PLAN_REQUIRED');
      plan=candidates[0];
      await retain(join(options.directory,'observed-plan-selection.json'),{
        mode:'EXPLICIT_NATIVE_PLAN_SELECTION',planId:plan.id,planDigest:plan.data.digest,
        matchedPlanIds:candidates.map(row=>row.id),selection:'Earliest complete native plan matching every normalized dataset/extraction/source field.'});
    }
    need(sameNativePlan(plan,state.plan,selected),'BASEROW_MCP_EXAMPLE_PLAN_CHANGED');
    await publishWrite('extract','extract',{planId:plan.id,planDigest:plan.data.digest,runId:state.ids.run});
    let runView=await publishRead('run',{runId:state.ids.run}),deadline=Date.now()+310000;
    while(runView.run.state==='EXTRACTING'){
      need(Date.now()<deadline,'BASEROW_MCP_EXAMPLE_EXTRACTION_TIMEOUT');
      await pause(250);runView=await publishRead('run',{runId:state.ids.run});
    }
    if(['INTERRUPTED','PUBLICATION_UNKNOWN'].includes(runView.run.state)){
      await publishWrite('recover','recover',{runId:state.ids.run});runView=await publishRead('run',{runId:state.ids.run});
    }
    need(['READY','REVIEWED','PUBLISHED'].includes(runView.run.state)&&
      runView.run.data.candidate.dataset.rowCount===original.manifest.rowCount,'BASEROW_MCP_EXAMPLE_EXTRACTION_INCOMPLETE');
    if(runView.run.state!=='PUBLISHED'){
      const reviewed=await publishWrite('review','review',async()=>{
        const target=await publishRead('target');
        need(target.initializable||target.connected,'BASEROW_MCP_EXAMPLE_TARGET_REQUIRED');
        return {runId:state.ids.run,candidateDigest:runView.run.data.candidate.candidateDigest,
          reviewer:'Commons original source operator',note:'Complete retained Baserow source operated and received through the original merchant MCP.',
          ...(target.initializable?{initialize:true}:{expectedSnapshot:target.versions.current,expectedRevision:target.versions.revision})};
      });
      const reviewRun=reviewed.mode==='ORIGINAL_PUBLISHER_RESULT'?reviewed.value:reviewed.run;
      need(reviewRun?.data.review?.candidateDigest===runView.run.data.candidate.candidateDigest,
        'BASEROW_MCP_EXAMPLE_REVIEW_CHANGED');
      await publishWrite('publish','publish',{runId:state.ids.run,reviewId:reviewRun.data.review.id});
      runView=await publishRead('run',{runId:state.ids.run});
    }
    need(runView.run.state==='PUBLISHED','BASEROW_MCP_EXAMPLE_PUBLICATION_INCOMPLETE');
    await atomicJson(options.directory,'published-run.json',runView);
    const selection={kind:'version',versionId:state.versionId,expectedCaptureSha256:state.captureSha256,
      expectedSourceSha256:state.sourceSha256};
    let deployment=null;
    if(terms){
      stage='original-merchant-deployment';
      const review=await once('deployment-review','merchant_baserow_deployment',()=>({workspace:'catalog',action:'review',
        input:{versionId:state.versionId,runId:state.ids.run,termsProfile:'original',requestId:state.ids.deploymentReview}}));
      const prepared=await once('deployment-prepare','merchant_baserow_deployment',()=>({workspace:'catalog',action:'prepare',
        input:{reviewRequestId:state.ids.deploymentReview,expectedReviewSha256:review.reviewSha256,requestId:state.ids.deploymentPrepare}}));
      const packageView=await native('merchant_baserow_deployment',{workspace:'catalog',action:'package',input:{id:state.ids.deploymentPrepare}});
      const staged=await once('deployment-stage','merchant_baserow_deployment',()=>({workspace:'catalog',action:'stage',
        input:{packageRequestId:state.ids.deploymentPrepare,expectedSourceSha256:packageView.sourceSha256,
          id:'baserow-original-customer',label:'Original Baserow customer',runtimeProfile:'original',requestId:state.ids.deploymentStage}}));
      Object.assign(selection,{kind:'handoff',packageRequestId:state.ids.deploymentPrepare,expectedPackageSha256:packageView.sourceSha256});
      deployment={review,prepared,package:packageView,staged};
      await retain(join(options.directory,'deployment-result.json'),deployment);
    }
    stage='complete-original-export';
    const exported=await client.call('merchant_baserow_export',{workspace:'catalog',exportId:state.exportId,selection});
    need(exported.state==='MANIFEST_RETAINED'&&exported.exportId===state.exportId,'BASEROW_MCP_EXAMPLE_EXPORT_INCOMPLETE');
    await retain(join(options.directory,'export-result.json'),exported);
    const packet=exported.manifest.files.find(file=>file.name==='baserow-source.json');
    need(packet,'BASEROW_MCP_EXAMPLE_SOURCE_PACKET_REQUIRED');
    stage='original-customer-import-through-mcp';
    const imported=await once('recipient-import','merchant_baserow_import',()=>({workspace:'recipient',exportId:state.exportId,
      expectedSha256:packet.sha256,title:state.recipientTitle,expectedDraftRevision:0,requestId:state.ids.import}));
    need(imported.capture.manifestSha256===state.captureSha256&&imported.draftSaved,'BASEROW_MCP_EXAMPLE_IMPORT_CHANGED');
    const preview=await once('recipient-preview','merchant_baserow_preview',()=>({workspace:'recipient',
      draftRevision:imported.draftRevision,requestId:state.ids.preview}));
    need(preview.complete&&preview.allRowsChecked&&Object.values(preview.reports)
      .every(value=>value.report.rowCount===original.manifest.rowCount),'BASEROW_MCP_EXAMPLE_PREVIEW_CHANGED');
    const recipientVersion=await once('recipient-version','merchant_baserow_version',()=>({workspace:'recipient',action:'save',
      input:{draftRevision:imported.draftRevision,previewId:preview.id,reviewer:'Commons original customer',
        note:'Received the complete original source packet through merchant MCP; all native rows and files retained.',
        expectedSelectedVersion:null,requestId:state.ids.version}}));
    need(recipientVersion.version.observationSha256===state.captureSha256,'BASEROW_MCP_EXAMPLE_VERSION_CHANGED');
    await closeSource();
    stage='retained-download-after-source-close';
    const downloadOptions={url:mcp.url+'/mcp',exportId:state.exportId,expectedManifestSha256:exported.manifestFile.sha256,
      directory:join(options.directory,'customer-files'),environment};
    const checkpointFile=join(options.directory,'download-interruption.json');
    if(!await exists(checkpointFile)){
      const resumingCheckpoint=await exists(join(downloadOptions.directory,'download-state','checkpoint.json'));
      let checkpoint;
      try{
        await downloadBaserowExport({...downloadOptions,chunkSize:1,onProgress:async progress=>{
          if(progress.bytes>0){checkpoint=progress;await retain(checkpointFile,{...progress,
            kind:resumingCheckpoint?'ORIGINAL_DURABLE_RESUMED_CHECKPOINT':'ORIGINAL_DURABLE_FIRST_BYTE'});
            throw fault('BASEROW_MCP_EXAMPLE_CHECKPOINT_REOPEN');}
        }});
        need(false,'BASEROW_MCP_EXAMPLE_CHECKPOINT_MISSING');
      }catch(issue){if(issue.code!=='BASEROW_MCP_EXAMPLE_CHECKPOINT_REOPEN')throw issue;}
      need(checkpoint?.bytes>0&&(resumingCheckpoint||checkpoint.bytes===1),'BASEROW_MCP_EXAMPLE_CHECKPOINT_CHANGED');
    }
    await closeMcp();await startMcp();
    const download=await downloadBaserowExport({...downloadOptions,url:mcp.url+'/mcp'});
    need(download.state==='COMPLETE'&&download.resumed&&download.resumedBytes>0,'BASEROW_MCP_EXAMPLE_DOWNLOAD_INCOMPLETE');
    await closeMcp();
    stage='offline-native-customer-reopen';
    const reopened=await receiveOffline(options,state,exported);
    need(reopened.selectedVersion===recipientVersion.selectedVersion,'BASEROW_MCP_EXAMPLE_REOPEN_CHANGED');
    const result={schema:SCHEMA,operation:OP,state:'COMPLETED',sourceRef:options.sourceRef,node:process.version,
      directory:options.directory,nativeRun:options.nativeRun,startedAt:state.startedAt,completedAt:new Date().toISOString(),
      input:inputs,source:{directory:state.sourceDirectory,versionId:state.versionId,sourceSha256:state.sourceSha256,
        captureId:state.captureId,captureSha256:state.captureSha256,...sourceRead},
      publication:{planId:plan.id,planDigest:plan.data.digest,runId:state.ids.run,state:runView.run.state,
        candidateDigest:runView.run.data.candidate.candidateDigest,snapshot:runView.run.data.publication.snapshot,
        csvSha256:runView.run.data.candidate.csvHash,rows:runView.run.data.candidate.dataset.rowCount},
      nativeRequests:state.ids,export:exported,deployment,download,customer:reopened,
      originalSourceBrowsersClosedBeforeDownload:true,mcpReopenedBeforeDownloadResume:true};
    await retain(join(options.directory,'mcp-customer-result.json'),result);
    process.stdout.write(JSON.stringify({state:result.state,directory:options.directory,exportId:state.exportId,
      sourceCaptureSha256:state.captureSha256,rows:count,files:fileCount,
      result:join(options.directory,'mcp-customer-result.json')})+'\n');
    return result;
  }catch(issue){
    await atomicJson(options.directory,'mcp-customer-failure.json',{schema:SCHEMA,operation:OP,state:'FAILED',stage,
      sourceRef:options.sourceRef,at:new Date().toISOString(),error:issue.code??'BASEROW_MCP_EXAMPLE_FAILED',
      message:issue.message,directory:options.directory});
    throw issue;
  }finally{
    try{await closeMcp();}finally{try{await closeSource();}finally{await release();}}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue=>{process.stderr.write(JSON.stringify({error:issue.code??'BASEROW_MCP_EXAMPLE_FAILED',message:issue.message})+'\n');process.exitCode=1;});
