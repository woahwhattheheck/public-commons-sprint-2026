// MIT. Complete source-native CoinGecko MCP receiving through the existing HTTP host.
import {mkdir,readFile,writeFile,rename,access} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const insist=(value,message)=>{if(!value)throw new Error(message)};
const options=new Map();
for(let i=2;i<process.argv.length;i+=2){
  insist(['--manifest','--out'].includes(process.argv[i])&&process.argv[i+1],'Use --manifest ORIGINAL_INPUTS.json --out PRIVATE_RECEIVING_DIRECTORY');
  insist(!options.has(process.argv[i]),'Duplicate receiving option');options.set(process.argv[i],process.argv[i+1]);
}
insist(options.has('--manifest')&&options.has('--out'),'Use --manifest ORIGINAL_INPUTS.json --out PRIVATE_RECEIVING_DIRECTORY');
const manifestPath=resolve(options.get('--manifest')),out=resolve(options.get('--out'));
const manifestBytes=await readFile(manifestPath),input=JSON.parse(manifestBytes);
insist(input.schema==='stellar-forge.coingecko-mcp-receiving.v1','Use the declared original receiving manifest');
insist(Array.isArray(input.requests)&&input.requests.length>=2,'Select the complete original request collection (at least two requests)');
insist(typeof input.operationPrefix==='string'&&/^[A-Za-z0-9._:-]{1,90}$/.test(input.operationPrefix),'Keep one stable operationPrefix');
const sourceRoot=resolve(dirname(manifestPath),input.sourceRoot),connection=resolve(dirname(manifestPath),input.connection);
const workspace=input.workspace??'market',receivingWorkspace=input.receivingWorkspace??'receiving';
insist(workspace!==receivingWorkspace,'Declare distinct original and receiving workspaces');
await mkdir(out,{recursive:true,mode:0o700});
const checkpointPath=join(out,'receiving-checkpoint.json');
let C;
try{C=JSON.parse(await readFile(checkpointPath,'utf8'))}
catch(error){if(error.code!=='ENOENT')throw error;C={schema:'stellar-forge.coingecko-mcp-receiving-checkpoint.v1',manifestSha256:digest(manifestBytes),requests:{},results:{},stages:{}}}
insist(C.manifestSha256===digest(manifestBytes),'Continue this operation with its original exact input manifest');
async function persist(){const temp=checkpointPath+'.next';await writeFile(temp,JSON.stringify(C,null,2)+'\n',{mode:0o600});await rename(temp,checkpointPath)}
await persist();
const {initializeCoinGeckoWorkspaceMerchant}=await import(pathToFileURL(join(sourceRoot,'stellar-forge/mcp-merchant-operator/config.mjs')));
const {startMerchantMcp}=await import(pathToFileURL(join(sourceRoot,'stellar-forge/mcp-merchant-operator/serve.mjs')));
const hostDirectory=join(out,'merchant-host'),configPath=join(hostDirectory,'merchant-mcp.json');
try{await access(configPath)}
catch(error){if(error.code!=='ENOENT')throw error;await initializeCoinGeckoWorkspaceMerchant({directory:hostDirectory,connection,name:'CoinGecko complete MCP receiving'})}
const bearer=randomBytes(32).toString('hex');
let session,protocol,sequence=0;
async function rpc(method,params={}){
  const response=await fetch(session.url,{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json',Accept:'application/json',
    ...(protocol?{'MCP-Protocol-Version':protocol}:{})},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});
  const value=await response.json();
  insist(response.ok&&!value.error,'Original MCP transport failed: '+JSON.stringify(value.error??{status:response.status}));
  return value.result;
}
async function call(name,args={},expectedError){
  const result=await rpc('tools/call',{name,arguments:args});
  const value=result.structuredContent??JSON.parse(result.content.find(c=>c.type==='text').text);
  if(expectedError){insist(result.isError&&value.code===expectedError,'Expected '+expectedError+', received '+JSON.stringify(value));return value}
  if(result.isError)throw Object.assign(new Error(name+': '+value.reason),{code:value.code});
  return value;
}
const native=async(name,args)=>{const result=await call(name,args);insist(result.native!==undefined,'Missing original model response');return result.native};
const project=async(id,alias=workspace)=>native('merchant_coingecko_project',{workspace:alias,projectId:id});
async function write(key,name,args,alias=workspace){
  if(C.results[key])return C.results[key];
  let retained=C.requests[key];
  if(!retained){
    retained={workspace:alias,...args,opId:input.operationPrefix+':'+key};
    if(args.projectId!==undefined)retained.revision=(await project(args.projectId,alias)).project.revision;
    C.requests[key]={name,arguments:retained};await persist();
  }else{insist(retained.name===name,'The retained operation selected a different tool');retained=retained.arguments}
  const response=await native(name,retained);C.results[key]=response;await persist();return response;
}
async function stage(key,fn){
  if(C.stages[key])return C.stages[key];
  const value=await fn();C.stages[key]={at:new Date().toISOString(),...value};await persist();
  process.stdout.write(JSON.stringify({stage:key,...C.stages[key]})+'\n');return C.stages[key];
}
async function records(kind,projectId,alias=workspace){
  const items=[];let offset=0,total;
  do{
    const page=await native('merchant_coingecko_records',{workspace:alias,projectId,kind,offset,limit:128});
    insist(page.offset===offset&&Array.isArray(page.items),'Invalid native record page');
    total=page.total;items.push(...page.items);offset+=page.items.length;
    insist(page.items.length||offset===total,'Native collection ended before its total');
  }while(offset<total);
  insist(items.length===total,'Native collection total changed during receiving');return items;
}
async function rows(kind,id,projectId,alias=workspace){
  const items=[];let offset=0,total;
  do{
    const page=await native('merchant_coingecko_rows',{workspace:alias,projectId,kind,id,offset,limit:128});
    total=page.total;items.push(...page.items);offset+=page.items.length;
    insist(page.items.length||offset===total,'Native rows ended before their total');
  }while(offset<total);
  insist(items.length===total,'Native row total changed during receiving');return items;
}
async function download(kind,id,projectId,alias=workspace,{expectedSha256,filename}={}){
  let offset=0,readId,metadata,chunks=[];
  do{
    const result=await call('merchant_coingecko_file_read',{workspace:alias,projectId,kind,id,offset,limit:65536,
      ...(expectedSha256?{expectedSha256}:{}),...(readId?{readId}:{})});
    metadata??=result.file;expectedSha256??=metadata.sha256;
    insist(result.file.sha256===expectedSha256&&result.offset===offset,'Original file selection changed');
    const bytes=Buffer.from(result.data,'base64');insist(bytes.length===result.bytesRead,'Native chunk length mismatch');
    chunks.push(bytes);offset=result.nextOffset;readId=result.readId;
  }while(offset!==null);
  const bytes=Buffer.concat(chunks);
  insist(bytes.length===metadata.bytes&&digest(bytes)===metadata.sha256,'Complete native file hash or length changed');
  if(filename)await writeFile(join(out,filename),bytes,{mode:0o600});
  return{bytes,metadata,chunks:chunks.length};
}
try{
  session=await startMerchantMcp({configPath,port:0,environment:{...process.env,COINGECKO_RECEIVING_TOKEN:bearer},tokenEnv:'COINGECKO_RECEIVING_TOKEN'});
  protocol=(await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'coingecko-original-receiving',version:'1'}})).protocolVersion;
  const catalog=await rpc('tools/list');
  const names=catalog.tools.filter(t=>t.name.startsWith('merchant_coingecko_')).map(t=>t.name);
  insist(names.length===32,'The complete 32-tool CoinGecko catalog is not installed');
  const host=await call('merchant_coingecko_workspaces');
  insist(host.workspaces.some(w=>w.workspace===workspace)&&host.workspaces.some(w=>w.workspace===receivingWorkspace),'Declare both owned workspaces');
  const opened=await call('merchant_coingecko_open',{workspace});
  const again=await call('merchant_coingecko_open',{workspace});
  insist(opened.instanceId===again.instanceId,'Repeated open changed the original owned instance');
  C.instanceId=opened.instanceId;C.browserUrl=opened.browserUrl;await persist();
  const status=await call('merchant_coingecko_status',{workspace});
  insist(status.native.contracts.length===5||Object.keys(status.native.contracts).length===5,'The original five endpoint families are missing');
  const made=await write('project','merchant_coingecko_project_create',{name:input.projectName??'CoinGecko original source MCP receiving'});
  const projectId=made.value.id;C.projectId=projectId;await persist();
  await stage('01_original_host_and_shared_project',async()=>{
    const response=await fetch(opened.browserUrl+'/api/projects/'+projectId);
    const browser=await response.json();insist(response.ok&&browser.project.id===projectId,'Original browser does not share the MCP project');
    await write('configuration','merchant_coingecko_configure',{projectId,config:input.projectConfig??{merchantOrigin:'',merchantPrefix:'/api/v3/stellar',buyerProfileId:''}});
    return{projectId,tools:names.length,endpointFamilies:5,browserSharesProject:true};
  });
  await stage('02_complete_source_collection',async()=>{
    const configured=await native('merchant_coingecko_sources',{workspace}),declared=new Set(configured.inputs.map(s=>s.input));
    const requestIds=[],captureIds=[],sampleIds=[],sourceFiles=[];
    for(const entry of input.requests){
      insist(typeof entry.key==='string'&&/^[a-z0-9_-]+$/.test(entry.key),'Use a stable original request key');
      const request=(await write('request-'+entry.key,'merchant_coingecko_request_save',{projectId,request:entry.definition})).value;
      requestIds.push(request.id);
      const imported={};
      for(const field of ['sourceInput','bodyInput','headersInput']){
        const alias=entry.capture[field];if(!alias)continue;
        insist(declared.has(alias),'Original input alias missing: '+alias);
        const inspection=await native('merchant_coingecko_source_inspect',{workspace,input:alias});
        const file=(await write('source-'+entry.key+'-'+field,'merchant_coingecko_source_import',{projectId,input:alias,expectedSha256:inspection.sha256})).value;
        imported[field]=file.id;sourceFiles.push({id:file.id,sha256:inspection.sha256,bytes:inspection.bytes,input:alias});
      }
      insist(imported.sourceInput,'A complete original response input is required');
      const capture=(await write('capture-'+entry.key,'merchant_coingecko_response_import',{projectId,requestId:request.id,fileId:imported.sourceInput,
        ...(imported.bodyInput?{responseBodyFileId:imported.bodyInput}:{}),...(imported.headersInput?{headersFileId:imported.headersInput}:{}),
        httpStatus:entry.capture.httpStatus,sourceUrl:entry.capture.sourceUrl,observedAt:entry.capture.observedAt,
        name:entry.definition.name+' / original retained source'})).value;
      captureIds.push(capture.id);
      const sample=(await write('example-'+entry.key,'merchant_coingecko_provider_example',{projectId,captureId:capture.id,name:entry.definition.name+' / original provider example'})).value;
      insist(sample.basis==='provider_bazaar_example','Original provider example basis changed');sampleIds.push(sample.id);
    }
    const collection=(await write('collection','merchant_coingecko_collection_save',{projectId,collection:{name:'Complete original CoinGecko source collection',
      description:'All selected original endpoint definitions and exact retained observations',requestIds}})).value;
    C.requestIds=requestIds;C.captureIds=captureIds;C.sampleIds=sampleIds;C.sourceFiles=sourceFiles;C.collectionId=collection.id;await persist();
    return{requestCount:requestIds.length,captures:captureIds.length,providerExamples:sampleIds.length,sourceFiles:sourceFiles.length,collectionId:collection.id};
  });
  await stage('03_exact_targets_and_current_revisions',async()=>{
    const requestId=C.requestIds[0];
    const inspected=await native('merchant_coingecko_inspect',{workspace,projectId,kind:'request',id:requestId});
    const definition={...input.requests[0].definition,notes:(input.requests[0].definition.notes??'')+'\nReceived through the original merchant MCP; source values remain unchanged.'};
    const updated=await write('request-reviewed','merchant_coingecko_request_save',{projectId,requestId,version:inspected.request.version,request:definition});
    const saved=C.requests['request-reviewed'].arguments;
    const replay=await native('merchant_coingecko_request_save',saved);
    insist(replay.replayed===true&&replay.value.id===requestId,'The original request write did not recover unchanged');
    await call('merchant_coingecko_request_save',{...saved,requestId:C.requestIds[1]},'OPERATION_CONFLICT');
    const recovered=await native('merchant_coingecko_operation',{workspace,projectId,opId:saved.opId});
    insist(recovered.state==='RETAINED'&&recovered.response.value.id===requestId,'Original operation lookup selected a different target');
    const current=await project(projectId);
    await call('merchant_coingecko_note_save',{workspace,projectId,opId:input.operationPrefix+':stale-revision',revision:Math.max(0,current.project.revision-1),
      note:{type:'research',title:'Stale write must not commit',text:'Original concurrent revision check',targetType:'request',targetId:requestId,status:'open'}},'STALE_REVISION');
    return{reviewedRequestId:updated.value.id,exactReplay:true,crossTargetRejected:true,staleRevisionRejected:true};
  });
  await stage('04_complete_rows_research_and_provider',async()=>{
    let total=0,linked=0;
    for(const id of C.sampleIds){
      const page=await rows('capture',id,projectId);total+=page.length;
      for(const row of page){
        const detail=await native('merchant_coingecko_row',{workspace,projectId,captureId:id,rowId:row.id});
        insist(detail.row?.id===row.id,'Original row inspection selected another row');linked+=Array.isArray(detail.included)?detail.included.length:Array.isArray(detail.entities)?detail.entities.length:0;
      }
    }
    const baseline=(await write('baseline','merchant_coingecko_snapshot_create',{projectId,name:'All original retained provider examples',captureIds:C.sampleIds,collectionId:C.collectionId})).value;
    const current=(await write('current','merchant_coingecko_snapshot_create',{projectId,name:'Unchanged original source receiving snapshot',captureIds:C.sampleIds,collectionId:C.collectionId})).value;
    const comparison=(await write('comparison','merchant_coingecko_comparison_create',{projectId,name:'Exact retained source comparison',baselineId:baseline.id,currentId:current.id})).value;
    const comparisonRows=await rows('comparison',comparison.id,projectId);
    insist((await rows('snapshot',baseline.id,projectId)).length===total,'Snapshot omitted original market rows');
    const note=(await write('research-note','merchant_coingecko_note_save',{projectId,note:{type:'data_quality',title:'Original source provenance retained',
      text:'The comparison reopens the same complete provider examples. Original observation times, exact decimal values, query definitions and source files remain attached.',
      targetType:'comparison',targetId:comparison.id,sourceFileIds:C.sourceFiles.map(f=>f.id),assignee:'Market operations',status:'reviewed'}})).value;
    const preview=await native('merchant_coingecko_provider_plan_preview',{workspace,plan:input.providerPlan});
    const plan=(await write('provider-plan','merchant_coingecko_provider_plan_save',{projectId,plan:input.providerPlan})).value;
    const document=await download('provider-plan',plan.id,projectId,workspace,{filename:'original-provider-deployment.json'});
    insist(JSON.parse(document.bytes).schema==='stellar-forge.coingecko-provider-deployment.v1','Native provider document changed');
    C.baselineId=baseline.id;C.currentId=current.id;C.comparisonId=comparison.id;C.noteId=note.id;C.providerPlanId=plan.id;await persist();
    return{sourceRows:total,linkedEntities:linked,comparisonRows:comparisonRows.length,providerPreview:Boolean(preview),providerDocumentSha256:document.metadata.sha256};
  });
  await stage('05_complete_file_delivery',async()=>{
    const collection=await download('collection',C.collectionId,projectId,workspace,{filename:'original-collection.json'});
    const packageValue=JSON.parse(collection.bytes);insist(packageValue.requests.length===input.requests.length,'Collection download omitted original requests');
    const snapshot=await download('snapshot',C.baselineId,projectId,workspace,{filename:'original-snapshot.json'});
    const comparison=await download('comparison',C.comparisonId,projectId,workspace,{filename:'original-comparison.json'});
    for(const source of C.sourceFiles){
      const result=await download('source',source.id,projectId,workspace,{expectedSha256:source.sha256});
      insist(result.bytes.length===source.bytes,'Original source file size changed');
    }
    C.preArchiveCounts=(await project(projectId)).counts;await persist();
    return{completeSourceFiles:C.sourceFiles.length,collectionSha256:collection.metadata.sha256,snapshotSha256:snapshot.metadata.sha256,comparisonSha256:comparison.metadata.sha256};
  });
  await stage('06_portable_handover_and_reception',async()=>{
    const handover=(await write('handover','merchant_coingecko_handover_create',{projectId,name:'CoinGecko complete original MCP research handover',
      snapshotId:C.currentId,comparisonId:C.comparisonId})).value;
    const full=await download('handover',handover.id,projectId,workspace,{expectedSha256:handover.sha256,filename:'coingecko-complete-handover.json.gz'});
    const first=await call('merchant_coingecko_file_read',{workspace,projectId,kind:'handover',id:handover.id,expectedSha256:handover.sha256,limit:1024});
    if(first.nextOffset!==null){
      await call('merchant_coingecko_file_release',{workspace,readId:first.readId});
      const resumed=await call('merchant_coingecko_file_read',{workspace,projectId,kind:'handover',id:handover.id,expectedSha256:handover.sha256,offset:first.nextOffset,limit:1024});
      insist(Buffer.from(resumed.data,'base64').equals(full.bytes.subarray(first.nextOffset,first.nextOffset+resumed.bytesRead)),'Released file read did not reopen the same bytes');
      if(resumed.nextOffset!==null)await call('merchant_coingecko_file_release',{workspace,readId:resumed.readId});
    }
    const received=await call('merchant_coingecko_open',{workspace:receivingWorkspace});C.receivingInstanceId=received.instanceId;await persist();
    const restored=(await write('restore','merchant_coingecko_restore',{name:'Received complete original CoinGecko research',
      sourceWorkspace:workspace,exportId:handover.id,expectedSha256:handover.sha256},receivingWorkspace)).value;
    const restoredId=restored.project.id,receivedProject=await project(restoredId,receivingWorkspace);
    for(const kind of ['requests','collections','captures','snapshots','comparisons','notes','providerPlans','jobs']){
      insist(receivedProject.counts[kind]===C.preArchiveCounts[kind],'Restoration changed complete '+kind+' count');
      insist((await records(kind,restoredId,receivingWorkspace)).length===C.preArchiveCounts[kind],'Restored paging omitted '+kind);
    }
    for(const original of C.sourceFiles){
      const id=restored.mapping.files[original.id];insist(id,'Original file ID mapping missing');
      await download('source',id,restoredId,receivingWorkspace,{expectedSha256:original.sha256});
    }
    C.exportId=handover.id;C.archiveSha256=handover.sha256;C.restoredProjectId=restoredId;C.mapping=restored.mapping;await persist();
    return{archiveBytes:full.bytes.length,archiveSha256:full.metadata.sha256,downloadChunks:full.chunks,restoredProjectId:restoredId,counts:receivedProject.counts};
  });
  await stage('07_reopen_same_projects',async()=>{
    const received=await call('merchant_coingecko_open',{workspace:receivingWorkspace});
    await call('merchant_coingecko_close',{workspace:receivingWorkspace,instanceId:received.instanceId});
    const original=await call('merchant_coingecko_open',{workspace});
    await call('merchant_coingecko_close',{workspace,instanceId:original.instanceId});
    const reopened=await call('merchant_coingecko_open',{workspace}),reopenedReceived=await call('merchant_coingecko_open',{workspace:receivingWorkspace});
    insist(reopened.instanceId!==original.instanceId&&reopenedReceived.instanceId!==received.instanceId,'Reopen did not acquire new owned instances');
    const a=await project(projectId),b=await project(C.restoredProjectId,receivingWorkspace);
    insist(a.counts.jobs===0&&b.counts.jobs===0,'Research receiving unexpectedly created a native purchase job');
    const sourceFile=C.sourceFiles[0];
    await download('source',sourceFile.id,projectId,workspace,{expectedSha256:sourceFile.sha256});
    await download('source',C.mapping.files[sourceFile.id],C.restoredProjectId,receivingWorkspace,{expectedSha256:sourceFile.sha256});
    return{originalProjectId:projectId,restoredProjectId:C.restoredProjectId,retainedResearch:true,nativePurchaseJobs:0};
  });
  const report={schema:'stellar-forge.coingecko-mcp-receiving-result.v1',status:'PASS',completedAt:new Date().toISOString(),
    sourceCommit:input.sourceCommit??null,manifestSha256:C.manifestSha256,stages:C.stages,projectId:C.projectId,restoredProjectId:C.restoredProjectId,
    archiveSha256:C.archiveSha256,sourceFamilies:input.requests.map(r=>r.definition.endpoint),paymentsInitiated:0};
  await writeFile(join(out,'NATIVE_MCP_RECEIVING_RESULT.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  process.stdout.write(JSON.stringify(report)+'\n');
}catch(error){
  C.lastFailure={at:new Date().toISOString(),code:error.code??null,message:error.message};await persist();throw error;
}finally{await session?.close()}
