#!/usr/bin/env node
// MIT. Continue one completed native Timescale project through its installed merchant and receiver.
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lstat } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { readMerchantConfig } from './config.mjs';
import { initializeMerchantProvider } from './providers.mjs';
import { inspectTimescaleAgentBinding, startTimescaleAgentWorkspace } from './timescale-workspace-launcher.mjs';
import { openMerchantFileClient } from './retained-download.mjs';
import { inspectTimescaleExport, downloadTimescaleExport } from './timescale-workspace-download.mjs';
import { timescaleAgentStartup } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-timescale.mjs';
import { openTimescaleWorkspace } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/model.mjs';
import { inspectTimescalePackage, receiveTimescaleWorkspace } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/package.mjs';
import { loadDatasetConfig } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-handler.mjs';
import { bytes, digest, readPrivate, readJson, createFile, atomicJson, privateDirectory, fault, stamp }
  from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';

const SCHEMA='stellar-forge.timescale-merchant-native-receiving.v1';
const WORKSPACE='usage',PUBLISHER='usage',TOKEN_ENV='TIMESCALE_RECEIVING_MCP_TOKEN';
async function exists(path){try{await lstat(path);return true;}catch(issue){if(issue.code==='ENOENT')return false;throw issue;}}
function need(value,code){if(!value)throw fault(code);}
async function originalJson(path,value){
  const body=bytes(value);
  if(await exists(path))need((await readPrivate(path)).equals(body),'TIMESCALE_RECEIVING_INPUT_CHANGED');
  else await createFile(path,body);
}
function receivedResult(value,workspaceId){
  need(value?.workspace===WORKSPACE&&value.workspaceId===workspaceId&&value.result&&typeof value.result==='object',
    'TIMESCALE_RECEIVING_WORKSPACE_CHANGED');
  return value.result;
}

/**
 * The native source/capture/refresh/job/publication operation must already be complete.
 * This continuation uses its original journal and dataset; it never seeds or refreshes a database.
 */
export async function runTimescaleMerchantReceiving({nativeResult,directory,playwright,chromium,browserReceiving}={}){
  nativeResult=resolve(nativeResult);directory=resolve(directory);
  const originalBytes=await readPrivate(nativeResult,16777216),native=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(originalBytes));
  need(native.schema==='stellar-forge.timescale-native-demo.v1'&&native.complete===true&&native.phases?.publish?.state==='COMPLETE'&&
    native.phases?.after?.state==='COMPLETE','TIMESCALE_RECEIVING_NATIVE_RESULT_REQUIRED');
  const nativeDirectory=dirname(nativeResult),workspaceDirectory=join(nativeDirectory,'workspace');
  need(directory!==nativeDirectory&&!directory.startsWith(workspaceDirectory+'/')&&directory!==workspaceDirectory,
    'TIMESCALE_RECEIVING_SEPARATE_DIRECTORY_REQUIRED');
  await privateDirectory(directory,true);
  const settings=await readJson(join(workspaceDirectory,'workspace.json'),16384),workspaceId=settings.id;
  const stateFile=join(settings.targetDirectory,'state.json');
  const originalStateDigest=digest(await readPrivate(stateFile,262144)),recordPath=join(directory,'receiving.json');
  let record;
  if(await exists(recordPath)){
    record=await readJson(recordPath,16777216);
    need(record.schema===SCHEMA&&record.nativeResult===nativeResult&&record.nativeResultSha256===digest(originalBytes)&&
      record.workspaceId===workspaceId&&record.datasetStateSha256===originalStateDigest,'TIMESCALE_RECEIVING_BINDING_CHANGED');
  }else{
    record={schema:SCHEMA,id:randomUUID(),createdAt:stamp(),nativeResult,nativeResultSha256:digest(originalBytes),
      nativeOperationId:native.id,workspaceId,datasetStateSha256:originalStateDigest,
      requestIds:{export:randomUUID(),receive:randomUUID()},phases:{},complete:false};
    await createFile(recordPath,bytes(record));
  }
  const save=()=>atomicJson(directory,'receiving.json',record);
  async function phase(name,work){
    if(record.phases[name]?.state==='COMPLETE')return record.phases[name].result;
    record.phases[name]={...record.phases[name],state:'RUNNING',startedAt:record.phases[name]?.startedAt??stamp()};await save();
    try{const result=await work();record.phases[name]={...record.phases[name],state:'COMPLETE',completedAt:stamp(),result};await save();
      process.stdout.write(JSON.stringify({phase:name,state:'COMPLETE',record:recordPath})+'\n');return result;}
    catch(issue){record.phases[name]={...record.phases[name],state:'FAILED',error:{code:issue.code??'TIMESCALE_RECEIVING_FAILED'}};await save();throw issue;}
  }
  // Once complete, reopen the same original receiving receipt without opening a source service.
  if(record.complete){
    const receipt=await receiveTimescaleWorkspace({requestId:record.requestIds.receive,
      packageDirectory:join(directory,'download'),expectedDigest:record.phases['complete-download'].result.nativeManifestSha256,
      directory:join(directory,'customer-project')});
    need(receipt.complete&&receipt.workspaceId===workspaceId,'TIMESCALE_RECEIVING_REOPEN_CHANGED');
    return{complete:true,reused:true,record:recordPath,receiving:receipt,sourceOperations:0};
  }
  const publishersFile=join(directory,'publishers.json'),connectionFile=join(directory,'timescale.json');
  const hostDirectory=join(directory,'merchant'),configFile=join(hostDirectory,'merchant-mcp.json');
  await phase('original-provider-setup',async()=>{
    await originalJson(publishersFile,{schema:'stellar-forge.merchant-publisher-connection.v1',
      workspaces:{[PUBLISHER]:{kind:'timescale',directory:workspaceDirectory}}});
    await originalJson(connectionFile,{schema:'stellar-forge.timescale-workspace-connection.v1',
      workspaces:{[WORKSPACE]:{label:'Original native usage project',publisher:PUBLISHER}}});
    if(!await exists(configFile))await initializeMerchantProvider('timescale-workspaces',
      {directory:hostDirectory,publishers:publishersFile,connection:connectionFile,name:'Native Timescale receiving'});
    const config=await readMerchantConfig(configFile);
    need(config.timescaleWorkspaces.workspaces[WORKSPACE].workspaceId===workspaceId&&
      config.publishers.workspaces[PUBLISHER].directory===workspaceDirectory,'TIMESCALE_RECEIVING_CONFIGURATION_CHANGED');
    return{configuration:configFile,workspaceId,publisher:PUBLISHER,provider:'timescale-workspaces'};
  });
  let host,received;
  const environment={...process.env,[TOKEN_ENV]:randomBytes(32).toString('hex')};
  try{
    const binding=await inspectTimescaleAgentBinding({configPath:configFile,workspace:WORKSPACE});
    const launch=async()=>{
      const value=await startTimescaleAgentWorkspace({configPath:configFile,workspace:WORKSPACE,
        port:record.ports?.browser??0,mcpPort:record.ports?.mcp??0,tokenEnv:TOKEN_ENV,environment,
        expectedBindingSha256:binding.bindingSha256});
      host=value; // Keep cleanup ownership even if the following durable checkpoint fails.
      record.ports={browser:Number(new URL(value.startup.operatorUrl).port),mcp:Number(new URL(value.startup.mcpUrl).port)};
      await save();return value;
    };
    host=await launch();
    const scoped=(name,args={})=>host.operator.call(name,{workspace:WORKSPACE,workspaceId,...args}).then(value=>receivedResult(value,workspaceId));
    await phase('installed-startup-and-shared-owner',async()=>{
      const request={command:'timescale-agent',args:['serve','--config',configFile,'--workspace',WORKSPACE,
        '--expected-binding-sha256',binding.bindingSha256,'--mcp-port',String(record.ports.mcp),
        '--token-env',TOKEN_ENV,'--port',String(record.ports.browser)]};
      const observed=timescaleAgentStartup(request,JSON.stringify(host.startup));
      const original=await host.operator.call('merchant_publisher_status',{publisher:PUBLISHER});
      need(observed.url===host.startup.operatorUrl&&original.instanceId===host.startup.publisherInstanceId,
        'TIMESCALE_RECEIVING_OWNER_CHANGED');
      return{startup:host.startup,application:observed,publisherInstanceId:original.instanceId,
        originalScheduler:original.schedule,sourceOperations:0};
    });
    await phase('retained-editions-plans-and-results',async()=>{
      const beforeId=native.phases.before.result.editionId,afterId=native.phases.after.result.editionId;
      const before=await scoped('merchant_timescale_edition',{editionId:beforeId,limit:100});
      const after=await scoped('merchant_timescale_edition',{editionId:afterId,limit:100});
      need(before.digest===native.phases.before.result.digest&&after.digest===native.phases.after.result.digest,
        'TIMESCALE_RECEIVING_EDITION_CHANGED');
      let offset=0,comparisonDigest,changes=0;
      do{
        const page=await scoped('merchant_timescale_compare',{beforeId,afterId,offset,limit:100});
        if(comparisonDigest)need(page.comparisonDigest===comparisonDigest,'TIMESCALE_RECEIVING_COMPARISON_CHANGED');
        comparisonDigest=page.comparisonDigest;changes+=page.changes.rows.length;offset=page.changes.nextOffset;
        if(offset===null)need(changes===page.changes.total,'TIMESCALE_RECEIVING_COMPARISON_INCOMPLETE');
      }while(offset!==null);
      const plan=await scoped('merchant_timescale_plan',{planId:native.phases.select.result.planId});
      const verification=await scoped('merchant_timescale_record',{requestId:native.requestIds['second-verify'],record:'result'});
      const tables=[];
      for(const table of after.tables){
        let index=0,total=0;
        do{const page=await scoped('merchant_timescale_edition',{editionId:afterId,table:table.table,offset:index,limit:100});
          total+=page.rows.length;index=page.nextOffset;
          if(index===null)need(total===table.rows,'TIMESCALE_RECEIVING_TABLE_INCOMPLETE');
        }while(index!==null);
        tables.push({table:table.table,rows:total});
      }
      const first=await scoped('merchant_timescale_file',{kind:'edition',id:afterId,expectedSha256:after.digest,offset:0,limit:97});
      need(first.file.sha256===after.digest&&first.file.bytes===after.bytes&&first.encoding==='base64'&&
        Buffer.from(first.data,'base64').length===Math.min(97,after.bytes),'TIMESCALE_RECEIVING_FILE_CHANGED');
      await scoped('merchant_timescale_file_release',{readId:first.readId});
      return{before:{id:beforeId,digest:before.digest},after:{id:afterId,digest:after.digest},comparisonDigest,changes,tables,
        selectedPlan:plan,verification,sourceChunk:{file:first.file,bytesRead:first.bytesRead,released:true},sourceOperations:0};
    });
    await phase('original-completed-request-recovery',async()=>{
      const original=await scoped('merchant_timescale_operation',{action:'inspect',requestId:native.requestIds.before});
      const status=await host.operator.call('merchant_timescale_status',{workspace:WORKSPACE,workspaceId});
      const replay=await scoped('merchant_timescale_capture',{...original.input,expectedVersion:status.native.version});
      need(original.state==='COMPLETE'&&replay.reused===true&&replay.operation.state==='COMPLETE'&&
        replay.operation.result.digest===native.phases.before.result.digest,'TIMESCALE_RECEIVING_REPLAY_CHANGED');
      return{id:replay.id,reused:replay.reused,state:replay.operation.state,editionDigest:replay.operation.result.digest,sourceOperations:0};
    });
    await phase('original-browser-receiving',async()=>{
      const run=browserReceiving??(await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/browser-receiving.mjs')).runTimescaleBrowserReceiving;
      const result=await run({url:host.startup.operatorUrl,nativeResult,outputDirectory:join(directory,'browser'),playwright,chromium});
      need(result.complete===true,'TIMESCALE_RECEIVING_BROWSER_INCOMPLETE');return result;
    });
    await phase('original-published-customer',async()=>{
      const value=await host.operator.call('merchant_publisher_inspect',{publisher:PUBLISHER,runId:native.phases.extract.result.runId,query:'limit=50'});
      need(value.run.state==='PUBLISHED'&&value.run.data?.publication?.snapshot===native.phases.publish.result.snapshot,
        'TIMESCALE_RECEIVING_PUBLICATION_CHANGED');
      return value;
    });
    const exported=await phase('native-complete-export',async()=>{
      const status=await host.operator.call('merchant_timescale_status',{workspace:WORKSPACE,workspaceId});
      const started=await scoped('merchant_timescale_export',{requestId:record.requestIds.export,expectedVersion:status.native.version});
      let operation=started.operation;
      const deadline=Date.now()+600000;
      while(['RUNNING','DISPATCHING'].includes(operation.state)){
        need(Date.now()<deadline,'TIMESCALE_RECEIVING_OPERATION_PENDING');
        await new Promise(done=>setTimeout(done,50));
        operation=await scoped('merchant_timescale_operation',{action:'inspect',requestId:started.id});
      }
      need(operation.state==='COMPLETE','TIMESCALE_RECEIVING_EXPORT_INCOMPLETE');
      const selected=await scoped('merchant_timescale_export_manifest',{exportId:started.id});
      return{exportId:started.id,...selected};
    });
    const client=await openMerchantFileClient({url:host.startup.mcpUrl,tokenEnv:TOKEN_ENV,environment,
      errorPrefix:'TIMESCALE',clientName:'starforge-timescale-native-receiving'});
    const downloadOptions={client,workspace:WORKSPACE,workspaceId,exportId:record.requestIds.export,
      directory:join(directory,'download'),expectedManifestSha256:exported.manifestFile.sha256,chunkSize:32768};
    await phase('interrupted-retained-download',async()=>{
      const control=new AbortController();let saved=null;
      try{
        await downloadTimescaleExport({...downloadOptions,signal:control.signal,onProgress:progress=>{
          if(!saved){saved=progress;control.abort(new Error('TIMESCALE_RECEIVING_INTENTIONAL_PAUSE'));}
        }});
        throw fault('TIMESCALE_RECEIVING_PAUSE_NOT_OBSERVED');
      }catch(issue){
        if(!control.signal.aborted||issue.code==='TIMESCALE_RECEIVING_PAUSE_NOT_OBSERVED')throw issue;
        need(saved?.bytes>0,'TIMESCALE_RECEIVING_PREFIX_MISSING');
        return{state:'PAUSED',file:saved.file,bytes:saved.bytes,total:saved.total,sourceOperations:0};
      }
    });
    const complete=await phase('complete-download',async()=>{
      const inspected=await inspectTimescaleExport(downloadOptions);
      const value=await downloadTimescaleExport(downloadOptions);
      need(value.state==='COMPLETE'&&value.resumed===true&&value.resumedBytes>0&&
        value.manifestSha256===exported.manifestFile.sha256&&value.files===inspected.manifest.files.length,
        'TIMESCALE_RECEIVING_DOWNLOAD_INCOMPLETE');
      const local=await inspectTimescalePackage(value.directory,value.nativeManifestSha256);
      need(local.workspaceId===workspaceId,'TIMESCALE_RECEIVING_PACKAGE_CHANGED');
      return{...value,nativeManifestSha256:local.manifestDigest,emptyDirectoriesPreserved:inspected.manifest.directories,
        nativePackageFiles:local.files,sourceOperations:0};
    });
    await phase('borrowed-browser-close-preserves-owner',async()=>{
      await scoped('merchant_timescale_browser',{action:'close'});
      const status=await host.operator.call('merchant_publisher_status',{publisher:PUBLISHER});
      need(status.instanceId===host.startup.publisherInstanceId,'TIMESCALE_RECEIVING_PUBLISHER_CLOSED_WITH_BROWSER');
      return{browser:'CLOSED',publisher:'OPEN',publisherInstanceId:status.instanceId};
    });
    await host.close();host=null;
    const reception=await phase('native-portable-receive',()=>receiveTimescaleWorkspace({
      requestId:record.requestIds.receive,packageDirectory:complete.directory,expectedDigest:complete.nativeManifestSha256,
      directory:join(directory,'customer-project')}));
    received=await openTimescaleWorkspace({directory:reception.directory});
    await phase('portable-project-reopen',async()=>{
      const state=received.status({limit:100}),edition=await received.edition(native.phases.after.result.editionId);
      const dataset=await loadDatasetConfig(join(reception.targetDirectory,'generations',native.phases.publish.result.snapshot,'dataset.json'));
      const page=dataset.handle({query:new URLSearchParams('limit=50')});
      need(state.id===workspaceId&&state.editions.total===2&&edition.record.digest===native.phases.after.result.digest&&
        page.status===200&&page.body.rows.length===4&&page.body.rows.some(row=>row.total==='9007199254740996.50'),
        'TIMESCALE_RECEIVING_PORTABLE_PROJECT_CHANGED');
      return{workspaceId:state.id,editions:state.editions.total,editionDigest:edition.record.digest,
        completeCustomerPage:page.body,sourceOperations:0};
    });
    await received.close();received=null;
    host=await launch();
    await phase('original-owner-reopen',async()=>{
      const state=await host.operator.call('merchant_timescale_status',{workspace:WORKSPACE,workspaceId});
      const manifest=await scoped('merchant_timescale_export_manifest',{exportId:record.requestIds.export});
      need(state.native.editions.total===2&&manifest.manifestFile.sha256===complete.manifestSha256,
        'TIMESCALE_RECEIVING_ORIGINAL_REOPEN_CHANGED');
      return{workspaceId,instanceId:state.instanceId,publisherInstanceId:state.publisherInstanceId,
        manifestSha256:manifest.manifestFile.sha256,editionCount:state.native.editions.total,sourceOperations:0};
    });
    await host.close();host=null;
    need(digest(await readPrivate(nativeResult,16777216))===record.nativeResultSha256&&
      digest(await readPrivate(stateFile,262144))===record.datasetStateSha256,'TIMESCALE_RECEIVING_ORIGINAL_INPUT_CHANGED');
    record.complete=true;record.completedAt=stamp();record.sourceOperations=0;record.allOwnedHandlesClosed=true;await save();
    return{complete:true,reused:false,record:recordPath,workspaceId,receiving:reception,download:complete,sourceOperations:0};
  }finally{await host?.close();await received?.close();}
}

export async function main(argv=process.argv.slice(2)){
  const options={};const names=new Map([['--native-result','nativeResult'],['--directory','directory'],
    ['--playwright','playwright'],['--chromium','chromium']]);
  while(argv.length){const key=argv.shift(),value=argv.shift();
    if(!names.has(key)||!value||options[names.get(key)])throw fault('TIMESCALE_RECEIVING_USAGE',
      'Use --native-result ORIGINAL_NATIVE_DEMO_JSON --directory PRIVATE_RECEIVING_DIRECTORY [--playwright MODULE] [--chromium EXECUTABLE].');
    options[names.get(key)]=value;
  }
  if(!options.nativeResult||!options.directory)throw fault('TIMESCALE_RECEIVING_USAGE');
  const result=await runTimescaleMerchantReceiving(options);process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue=>{process.stderr.write(JSON.stringify({error:issue.code??'TIMESCALE_RECEIVING_FAILED'})+'\n');process.exitCode=1;});
