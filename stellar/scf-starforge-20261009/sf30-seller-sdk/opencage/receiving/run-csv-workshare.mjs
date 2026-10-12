#!/usr/bin/env node
// MIT. Receive the original OpenCage CSV operator, customer, CLI and MCP product.
import {readFile,lstat,realpath,mkdir,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,relative,dirname,sep,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {GeocodeWorkspace} from '../workspace.mjs';
import {GeocodeDelivery,csvCell} from '../customer.mjs';
import {GeocodeBatchDelivery} from '../batch-delivery.mjs';
import {createGeocodeServer} from '../server.mjs';
import {prepareGeocodeManagedSelection,verifyGeocodeManagedStartup} from '../launch.mjs';
import {jsonBytes,digest,writeJson,putOnce,readJson,exists,privateDirectory} from '../../twelvedata/files.mjs';
import {MerchantOpenCageWorkspaces,readOpenCageWorkspaceConfiguration} from '../../../../../stellar-forge/mcp-merchant-operator/opencage-workspace.mjs';
import {exerciseCsvBrowser} from './csv-browser.mjs';

const SCHEMA='commons.scf-opencage-csv-receiving/v1';
const HASH=/^[a-f0-9]{64}$/;
const must=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const same=(a,b)=>digest(jsonBytes(a))===digest(jsonBytes(b));
const delay=ms=>new Promise(done=>setTimeout(done,ms));
function argumentsOf(argv){
  const result={};
  for(let i=0;i<argv.length;i+=2){
    must(['--input','--input-sha256','--record'].includes(argv[i])&&argv[i+1]&&!Object.hasOwn(result,argv[i]),'CSV_RECEIVING_ARGUMENT_INVALID');
    result[argv[i]]=argv[i+1];
  }
  must(Object.keys(result).length===3&&HASH.test(result['--input-sha256']),'CSV_RECEIVING_ARGUMENT_REQUIRED');
  return result;
}
async function bytesAt(path,maximum=33554432){
  must(isAbsolute(path)&&resolve(path)===path&&await realpath(path)===path,'CSV_RECEIVING_PATH_CHANGED');
  const info=await lstat(path);
  must(info.isFile()&&!info.isSymbolicLink()&&info.size<=maximum,'CSV_RECEIVING_FILE_INVALID');
  const bytes=await readFile(path),after=await lstat(path);
  must(bytes.length===info.size&&info.dev===after.dev&&info.ino===after.ino&&info.size===after.size&&
    info.mtimeMs===after.mtimeMs&&info.ctimeMs===after.ctimeMs,'CSV_RECEIVING_FILE_CHANGED');
  return bytes;
}
function childPath(root,name){
  const path=resolve(root,name),part=relative(root,path);
  must(part&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part),'CSV_RECEIVING_PATH_OUTSIDE_ROOT');
  return path;
}
async function pinned(path,sha,bytes){
  const value=await bytesAt(path);
  must(HASH.test(sha)&&digest(value)===sha&&(bytes===undefined||value.length===bytes),'CSV_RECEIVING_SOURCE_CHANGED');
  return value;
}
async function nativeRecord(selection,{successful=true}={}){
  const records={};
  for(const name of ['request','result','artifacts'])records[name]=JSON.parse(await pinned(join(selection.record,name+'.json'),selection[name+'Sha256']));
  const {request,result,artifacts}=records;
  must(request.intent&&(!selection.operationId||request.intent.operation_id===selection.operationId)&&
    (successful?result.state==='completed'&&result.exit_code===0:
      result.state==='completed'&&result.exit_code===0||result.state==='failed'&&Number.isSafeInteger(result.exit_code)&&result.exit_code!==0)&&Array.isArray(artifacts.files)&&
    !(artifacts.errors??[]).length&&result.artifacts?.files===artifacts.files.length&&
    result.artifacts.bytes===artifacts.files.reduce((n,row)=>n+row.bytes,0),'CSV_RECEIVING_NATIVE_OUTCOME_REQUIRED');
  const files=new Map();
  for(const item of artifacts.files){
    must(typeof item.path==='string'&&!files.has(item.path)&&HASH.test(item.sha256)&&Number.isSafeInteger(item.bytes),'CSV_RECEIVING_NATIVE_ARTIFACT_INVALID');
    files.set(item.path,item);
  }
  const artifact=async path=>{
    const selected=files.get(path);must(selected,'CSV_RECEIVING_NATIVE_ARTIFACT_REQUIRED');
    return pinned(childPath(request.intent.project,path),selected.sha256,selected.bytes);
  };
  return {...records,files,artifact,selection};
}
async function nativeDirectory(native,directory){
  const prefix=relative(native.request.intent.project,directory).split(sep).join('/')+'/';
  must(!prefix.startsWith('../')&&!isAbsolute(prefix),'CSV_RECEIVING_ORIGINAL_DIRECTORY_INVALID');
  const items=[...native.files.values()].filter(item=>item.path.startsWith(prefix));
  must(items.length>0,'CSV_RECEIVING_ORIGINAL_FILES_REQUIRED');
  for(const item of items)await native.artifact(item.path);
  return items;
}
async function sourceBinding(input){
  const bytes=await pinned(input.sourceManifestPath,input.sourceManifestSha256,undefined);
  const manifest=JSON.parse(bytes);
  must(manifest.sourceRoot===input.sourceRoot&&Array.isArray(manifest.files)&&manifest.files.length>0,'CSV_RECEIVING_INSTALLATION_INVALID');
  const names=new Set();
  for(const item of manifest.files){
    must(typeof item.path==='string'&&!names.has(item.path)&&/^[a-f0-9]{40}$/.test(item.gitBlob)&&HASH.test(item.sha256),'CSV_RECEIVING_INSTALLATION_ENTRY_INVALID');
    names.add(item.path);
    const content=await pinned(childPath(input.sourceRoot,item.path),item.sha256,item.bytes);
    const blob=createHash('sha1').update('blob '+content.length+'\0').update(content).digest('hex');
    must(blob===item.gitBlob,'CSV_RECEIVING_INSTALLATION_BLOB_CHANGED');
  }
  const driver=fileURLToPath(import.meta.url);
  must(names.has(relative(input.sourceRoot,driver).split(sep).join('/')),'CSV_RECEIVING_DRIVER_OUTSIDE_INSTALLATION');
  return {sourceCommit:manifest.sourceCommit,files:manifest.files.length,bytes:manifest.files.reduce((n,x)=>n+x.bytes,0),
    manifestSha256:digest(bytes)};
}
async function directJSON(base,path){
  const url=new URL(base);
  return new Promise((done,reject)=>{
    const call=httpRequest({hostname:'127.0.0.1',port:Number(url.port),method:'GET',path,agent:false,
      headers:{authorization:'Bearer '+url.hash.slice(1),accept:'application/json'}},response=>{
      const chunks=[];let count=0;
      response.on('data',chunk=>{count+=chunk.length;if(count>4194304)call.destroy(new Error('CSV_RECEIVING_HTTP_TOO_LARGE'));else chunks.push(chunk);});
      response.once('error',reject);response.once('end',()=>{
        try{must(response.statusCode===200,'CSV_RECEIVING_HTTP_STATUS');done(JSON.parse(Buffer.concat(chunks)));}
        catch(error){reject(error);}
      });
    });
    call.once('error',reject);call.setTimeout(10000,()=>call.destroy(new Error('CSV_RECEIVING_HTTP_TIMEOUT')));call.end();
  });
}
async function waitFor(check,maximum=30000){
  const until=Date.now()+maximum;
  while(true){const result=await check();if(result)return result;must(Date.now()<until,'CSV_RECEIVING_STATE_TIMEOUT');await delay(100);}
}
function csvFixture(query){
  const rows=[['customer_id','query','note']];
  for(let n=1;n<=50;n++)rows.push([n<=2?'duplicate-id':'location-'+String(n).padStart(3,'0'),query,
    n===1?'First line\nSecond line':n===2?'=1+1':'Retained native query '+n]);
  rows.push(['missing-query','','Review the original empty query']);
  rows.push(['shape-exception',query,'The extra original cell stays retained','EXTRA']);
  return Buffer.from('\ufeff'+rows.map(row=>row.map(value=>csvCell(value)).join(',')).join('\r\n')+'\r\n');
}
async function receiveDelivery(delivery,destination){
  await privateDirectory(destination);
  const descriptors=[delivery.manifestFile,...delivery.files.values(),...delivery.objects.values()];
  const received=[];
  for(const file of descriptors){
    const path=childPath(destination,file.name);await mkdir(dirname(path),{recursive:true,mode:0o700});
    if(await exists(path)){await pinned(path,file.sha256,file.bytes);received.push(file);continue;}
    const selected=await delivery.openFile(file.name),temporary=path+'.partial-'+randomUUID();
    let target;
    try{
      target=await open(temporary,'wx',0o600);
      const buffer=Buffer.alloc(65536);let position=0;
      while(position<file.bytes){
        const read=await selected.handle.read(buffer,0,Math.min(buffer.length,file.bytes-position),position);
        must(read.bytesRead>0,'CSV_RECEIVING_DELIVERY_READ_ENDED');
        let written=0;
        while(written<read.bytesRead){
          const result=await target.write(buffer,written,read.bytesRead-written,position+written);
          must(result.bytesWritten>0,'CSV_RECEIVING_DELIVERY_WRITE_ENDED');written+=result.bytesWritten;
        }
        position+=read.bytesRead;
      }
      await target.sync();await target.close();target=null;await selected.handle.close();
      await pinned(temporary,file.sha256,file.bytes);await rename(temporary,path);
      received.push(file);
    }finally{await target?.close().catch(()=>{});await selected.handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  }
  const reopened=await GeocodeBatchDelivery.open(destination,{expectedIdentity:delivery.manifest.identity});
  const verification=await reopened.verify();
  return {directory:destination,identity:delivery.manifest.identity,exportId:delivery.manifest.exportId,
    manifestSha256:delivery.manifestFile.sha256,files:received.length,bytes:received.reduce((n,x)=>n+x.bytes,0),verification};
}
async function runCLI(args,{cwd,environment}){
  const child=spawn(process.execPath,args,{cwd,env:environment,stdio:['ignore','pipe','pipe']});
  const output=[],errors=[];let size=0;
  child.stdout.on('data',bytes=>{size+=bytes.length;if(size>4194304)child.kill('SIGTERM');else output.push(bytes);});
  child.stderr.on('data',bytes=>{if(Buffer.concat(errors).length<65536)errors.push(bytes);});
  const result=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>done({code,signal}));});
  must(result.code===0,'CSV_RECEIVING_CLI_FAILED');
  return {result:JSON.parse(Buffer.concat(output)),stderrSha256:digest(Buffer.concat(errors)),exitCode:result.code};
}
async function managedRun({cli,workspace,sourceDirectory,selectionPath,selection,batchId,exportId,environment}){
  const command=[cli,'serve','--workspace',workspace,'--managed-selection',selectionPath,'--port','0'];
  const child=spawn(process.execPath,command,{env:environment,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';const ended=new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>done({code,signal}));});
  child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{stdout+=part;if(stdout.length>65536)child.kill('SIGTERM');});
  child.stderr.setEncoding('utf8');child.stderr.on('data',part=>{if(stderr.length<65536)stderr+=part;});
  try{
    const startup=await waitFor(()=>{if(child.exitCode!==null)throw new Error('CSV_RECEIVING_MANAGED_EXITED');const line=stdout.split('\n')[0];return stdout.includes('\n')?JSON.parse(line):null;});
    const verified=await verifyGeocodeManagedStartup(startup,{selection,launchSourceDirectory:sourceDirectory,port:0});
    const state=await directJSON(verified.url,'/api/workspace?offset=0&limit=1');
    const batch=await directJSON(verified.url,'/api/batch?batchId='+encodeURIComponent(batchId)+'&offset=50&limit=50');
    const delivery=await directJSON(verified.url,'/api/batch-delivery?exportId='+encodeURIComponent(exportId)+'&offset=0&limit=1');
    must(batch.total===52&&batch.rows.length===2&&delivery.total===52,'CSV_RECEIVING_MANAGED_BATCH_CHANGED');
    must(state.identity===selection.workspace.workspaceIdentity,'CSV_RECEIVING_MANAGED_WORKSPACE_CHANGED');
    return {instanceId:startup.instanceId,pid:startup.pid,workspaceIdentity:startup.workspaceIdentity,
      sourceSha256:startup.sourceSha256,selectionSha256:startup.selectionSha256,sourceFiles:selection.source.files.length,
      batchId,exportId,customerIdentity:delivery.identity};
  }finally{
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
    const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);
    try{const result=await ended;must(result.code===0,'CSV_RECEIVING_MANAGED_STOP_FAILED');}finally{clearTimeout(timeout);}
  }
}

export async function receiveCsvWorkshare({input,inputBytes,inputPath,record}){
  must(input.schema===SCHEMA&&typeof input.operationId==='string','CSV_RECEIVING_INPUT_INVALID');
  const ownBytes=await bytesAt(join(record,'request.json')),own=JSON.parse(ownBytes);
  const driver=fileURLToPath(import.meta.url),expected=[process.execPath,driver,'--input',inputPath,'--input-sha256',digest(inputBytes),'--record',record];
  must(own.intent.operation_id===input.operationId&&same(own.intent.command,expected),'CSV_RECEIVING_NATIVE_COMMAND_CHANGED');
  must(resolve(input.outputDirectory)===input.outputDirectory&&relative(own.intent.project,input.outputDirectory)&&
    !relative(own.intent.project,input.outputDirectory).startsWith('..'),'CSV_RECEIVING_OUTPUT_OUTSIDE_PROJECT');
  await privateDirectory(input.outputDirectory);
  const reportPath=join(input.outputDirectory,'journey.json');
  let report=await exists(reportPath)?await readJson(reportPath,4194304):{schema:SCHEMA,inputSha256:digest(inputBytes),startedAt:new Date().toISOString(),stages:[]};
  must(report.inputSha256===digest(inputBytes),'CSV_RECEIVING_REPLAY_CHANGED');
  report.receiving={operationId:input.operationId,record,requestSha256:digest(ownBytes),project:own.intent.project,
    driverSha256:digest(await bytesAt(driver))};
  async function stage(name,value){
    const item={name,at:new Date().toISOString(),...value};const at=report.stages.findIndex(row=>row.name===name);
    if(at<0)report.stages.push(item);else report.stages[at]=item;
    await writeJson(reportPath,report);process.stdout.write(JSON.stringify({stage:name,...value})+'\n');return value;
  }
  const environment={PATH:process.env.PATH??'',LANG:'C.UTF-8',...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{})};
  let workspace,operator,browser,mcp;const customers=[];
  try{
    report.source=await sourceBinding(input);
    const completed=await nativeRecord(input.completedNative);
    const finished=JSON.parse(await completed.artifact('run/journey.json'));
    must(finished.schema==='commons.scf-opencage-release-completion/v1'&&finished.outcome==='COMPLETE'&&
      finished.receiving.operationId===completed.request.intent.operation_id,'CSV_RECEIVING_ORIGINAL_COMPLETION_CHANGED');
    const original=await nativeRecord(finished.original,{successful:false});
    const sourceDirectory=finished.original.customer.directory;
    const originals=await nativeDirectory(original,sourceDirectory);
    const source=await GeocodeDelivery.open(sourceDirectory);
    must(source.identity===finished.original.customer.identity&&
      source.responseSha256===finished.original.buyer.responseSha256&&
      digest(await bytesAt(join(sourceDirectory,'manifest.json')))===finished.original.customer.manifestSha256,'CSV_RECEIVING_ORIGINAL_CUSTOMER_CHANGED');
    const observationBytes=source.attachments.get('http-observation.json');
    must(observationBytes,'CSV_RECEIVING_ORIGINAL_HTTP_OBSERVATION_REQUIRED');
    const observation=JSON.parse(observationBytes);
    const originalWorkspace=await GeocodeWorkspace.open(input.originalWorkspaceDirectory,{readOnly:true,env:{}});
    let configuration;
    try{
      configuration=originalWorkspace.configuration;
      const retained=await originalWorkspace.get(source.request.id);
      must(retained.responseSha256===source.responseSha256&&same(retained.request,source.request)&&
        retained.captureIdentity===source.provenance.captureIdentity,'CSV_RECEIVING_ORIGINAL_CAPTURE_CHANGED');
    }finally{await originalWorkspace.close();}
    const sourceId=source.request.id,productId=source.request.productId;
    const {q,...options}=source.request.query;
    const mapping={idColumn:'customer_id',queryColumn:'query',options,optionColumns:{}};
    const csv=csvFixture(q),retryCsv=Buffer.from('"customer_id","query"\r\n"retry-native",'+csvCell(q)+'\r\n');
    const retryMapping={idColumn:'customer_id',queryColumn:'query',options,optionColumns:{}};
    const inputRoot=await privateDirectory(join(input.outputDirectory,'inputs'));
    for(const [name,bytes] of [['locations.csv',csv],['retry.csv',retryCsv],['response.json',source.bytes()],['http-observation.json',observationBytes]])
      await putOnce(join(inputRoot,name),bytes);
    await putOnce(join(inputRoot,'mapping.json'),jsonBytes(mapping));
    await stage('original-native-response-and-csv-source-joined',{
      completedNative:input.completedNative,sourceNative:finished.original.operationId,sourceManifestSha256:finished.original.customer.manifestSha256,
      sourceFiles:originals.length,sourceOutcome:{state:original.result.state,exitCode:original.result.exit_code},
      sourceRequestId:sourceId,sourceCaptureIdentity:source.provenance.captureIdentity,
      responseSha256:source.responseSha256,responseBytes:source.bytes().length,csvSha256:digest(csv),rows:52,
      sampleMeaning:'The input rows exercise retained review and delivery. Their successful responses reuse one actual official OpenCage test-key response, which returns its fixed Münster location.'});
    const workspaceDirectory=join(input.outputDirectory,'workspace');
    workspace=await GeocodeWorkspace.open(workspaceDirectory,{plan:configuration.plan,terms:configuration.terms,env:{}});
    const imported=await workspace.importResponse({id:sourceId,productId,input:source.request.query,observation,bytes:source.bytes()});
    must(imported.responseSha256===source.responseSha256,'CSV_RECEIVING_IMPORTED_RESPONSE_CHANGED');
    const manager=await workspace.batches();
    const retryInput={bytes:retryCsv,productId,mapping:retryMapping,label:'Reviewed configuration recovery',fileName:'retry.csv',reuseRequestIds:[]};
    const retryReview=await manager.review(retryInput);await manager.prepare({...retryInput,expectedReviewSha256:retryReview.reviewSha256});
    let retryRow=await manager.row(retryReview.batchId,1);
    if(retryRow.attempt===1&&retryRow.status==='READY'){
      await manager.start({batchId:retryReview.batchId,runId:'browser-configuration-refusal'});
      await manager.wait(retryReview.batchId,'browser-configuration-refusal');
      retryRow=await manager.row(retryReview.batchId,1);
    }
    must(retryRow.attempt>1||retryRow.status==='EXCEPTION','CSV_RECEIVING_ORIGINAL_CONFIGURATION_FAILURE_REQUIRED');
    operator=await createGeocodeServer({workspace,port:0});
    const {chromium}=await import(pathToFileURL(input.browser.playwright).href);
    browser=await chromium.launch({headless:true,executablePath:input.browser.chromium,
      args:['--no-sandbox','--disable-dev-shm-usage']});
    const browserResult=await exerciseCsvBrowser({
      browser,operatorUrl:operator.url,outputDirectory:join(input.outputDirectory,'browser'),
      csv:{bytes:csv,fileName:'locations.csv',productId,mapping,reuseRequestId:sourceId},
      retry:{batchId:retryReview.batchId,ordinal:1},
      onRetryPrepared:async({requestId,batchId,ordinal})=>{
        const current=await manager.row(batchId,ordinal);
        must(current.requestId===requestId&&current.attempt>1,'CSV_RECEIVING_RETRY_CHANGED');
        const value=await workspace.reuseCapture({id:requestId,productId,input:source.request.query,
          sourceId,sourceCaptureIdentity:imported.captureIdentity});
        must(value.responseSha256===source.responseSha256,'CSV_RECEIVING_RETRY_SOURCE_CHANGED');
        return {requestId,responseSha256:value.responseSha256};
      },
      openCustomer:async exportId=>{
        const batchDelivery=await manager.openDelivery(exportId),service=await createGeocodeServer({batchDelivery,port:0});
        customers.push(service);return {url:service.url};
      },
    });
    await stage('complete-csv-browser-and-customer-review',browserResult);
    const batchId=browserResult.phases?.intake?.batchId,exportId=browserResult.phases?.export?.exportId;
    must(typeof batchId==='string'&&typeof exportId==='string','CSV_RECEIVING_BROWSER_OUTPUT_REQUIRED');
    const current=await manager.status(batchId),row1=await manager.row(batchId,1),row2=await manager.row(batchId,2);
    must(current.total===52&&row1.result.decision.current?.index===0&&row2.result.decision.current===null&&
      row1.result.responseSha256===row2.result.responseSha256&&row1.requestId!==row2.requestId,'CSV_RECEIVING_INDEPENDENT_DECISIONS_CHANGED');
    const delivery=await manager.openDelivery(exportId);
    const received=await receiveDelivery(delivery,join(input.outputDirectory,'customer-delivery'));
    const retryCurrent=await manager.status(retryReview.batchId);
    const retryExport=await manager.export({batchId:retryReview.batchId,expectedRevision:retryCurrent.revision});
    const retryDelivery=await manager.openDelivery(retryExport.exportId);
    const retryReceived=await receiveDelivery(retryDelivery,join(input.outputDirectory,'retry-delivery'));
    const retried=await retryDelivery.row(1);
    must(retried.row.attempt===2&&retried.row.retryHistory.length===1,'CSV_RECEIVING_RETRY_HISTORY_REQUIRED');
    await stage('complete-customer-projections-and-retry-history-received',{main:received,retry:retryReceived});
    for(const service of customers.splice(0))await service.close();
    await browser.close();browser=null;
    await operator.close();operator=null;workspace=null;
    const cli=join(dirname(driver),'..','cli.mjs');
    const cliRead=await runCLI([cli,'batch-read','--delivery',received.directory,'--verify','true'],{cwd:own.intent.project,environment});
    await stage('original-cli-customer-reopened',{identity:received.identity,result:cliRead.result,exitCode:cliRead.exitCode});
    const connectionPath=join(input.outputDirectory,'mcp-connection.json');
    await putOnce(connectionPath,jsonBytes({schema:'stellar-forge.opencage-workspace-connection.v1',
      workspaces:{locations:{label:'Original CSV geocoding workshare',directory:workspaceDirectory,
        csvSources:{retry:join(inputRoot,'retry.csv')},
        imports:{native:{observation:join(inputRoot,'http-observation.json'),response:join(inputRoot,'response.json')}}}}}));
    const connection=await readOpenCageWorkspaceConfiguration(connectionPath);
    const newMcp=()=>new MerchantOpenCageWorkspaces({opencageWorkspaces:connection},{env:{}});
    mcp=newMcp();let toolCalls=0;
    const call=async(name,args)=>{toolCalls++;return mcp.call(name,args);};
    await call('merchant_opencage_open',{workspace:'locations'});
    const common={workspace:'locations',source:'retry',productId,mapping:retryMapping,label:'Agent configuration recovery',reuseRequestIds:[]};
    const sourceView=(await call('merchant_opencage_batch_source',{workspace:'locations',source:'retry'})).native;
    must(sourceView.sourceSha256===digest(retryCsv),'CSV_RECEIVING_MCP_SOURCE_CHANGED');
    const mcpReview=(await call('merchant_opencage_batch_review',common)).native;
    await call('merchant_opencage_batch_prepare',{...common,expectedReviewSha256:mcpReview.reviewSha256});
    const mcpRow=async()=>(await call('merchant_opencage_batch_inspect',{workspace:'locations',view:'row',batchId:mcpReview.batchId,ordinal:1})).native;
    let agentRow=await mcpRow();
    if(agentRow.attempt===1&&agentRow.status==='READY'){
      await call('merchant_opencage_batch_run',{workspace:'locations',action:'start',batchId:mcpReview.batchId,runId:'agent-configuration-refusal'});
      await waitFor(async()=>{const state=(await call('merchant_opencage_batch_inspect',{workspace:'locations',view:'rows',batchId:mcpReview.batchId})).native;return !state.active&&state.run?.state!=='RUNNING'?state:null;});
      agentRow=await mcpRow();
    }
    if(agentRow.attempt===1){
      must(agentRow.status==='EXCEPTION','CSV_RECEIVING_MCP_ORIGINAL_FAILURE_REQUIRED');
      await call('merchant_opencage_batch_retry',{workspace:'locations',batchId:mcpReview.batchId,ordinal:1,
        expectedRequestId:agentRow.requestId,expectedResponseSha256:agentRow.result.responseSha256,
        reason:'Reuse the retained native observation for this exact query after the recorded host-configuration refusal.'});
      agentRow=await mcpRow();
    }
    must(agentRow.attempt===2,'CSV_RECEIVING_MCP_RETRY_CHANGED');
    await call('merchant_opencage_import_response',{workspace:'locations',source:'native',id:agentRow.requestId,productId,input:source.request.query});
    agentRow=await mcpRow();
    if(agentRow.result.decision.revision===0)
      await call('merchant_opencage_batch_select',{workspace:'locations',batchId:mcpReview.batchId,ordinal:1,
        expectedRequestId:agentRow.requestId,responseSha256:source.responseSha256,expectedRevision:0,index:0,note:'Explicit operator choice of the retained native candidate.'});
    await call('merchant_opencage_batch_run',{workspace:'locations',action:'reconcile',batchId:mcpReview.batchId});
    const agentState=(await call('merchant_opencage_batch_inspect',{workspace:'locations',view:'rows',batchId:mcpReview.batchId})).native;
    const agentExport=(await call('merchant_opencage_batch_export',{workspace:'locations',batchId:mcpReview.batchId,expectedRevision:agentState.revision})).native;
    const customer=(await call('merchant_opencage_customer',{workspace:'locations',action:'open',kind:'batch-delivery',exportId:agentExport.exportId})).native;
    must((await directJSON(customer.browserUrl,'/api/workspace')).batchDelivery.identity===agentExport.manifest.identity,'CSV_RECEIVING_MCP_CUSTOMER_CHANGED');
    const selection={workspace:'locations',kind:'batch-delivery',id:agentExport.exportId,file:'results.csv'};
    const first=await call('merchant_opencage_file_read',{...selection,limit:64});
    must(first.offset===0&&first.bytesRead===64&&first.nextOffset===64&&first.encoding==='base64','CSV_RECEIVING_MCP_FIRST_CHUNK_CHANGED');
    const chunks=[Buffer.from(first.data,'base64')],expectedSha256=first.file.sha256;
    await mcp.close();mcp=newMcp();await call('merchant_opencage_open',{workspace:'locations'});
    let offset=first.nextOffset,readId;
    while(offset!==null){
      const next=await call('merchant_opencage_file_read',{...selection,expectedSha256,offset,limit:65536,...(readId?{readId}:{})});
      const bytes=Buffer.from(next.data,'base64');
      must(next.offset===offset&&bytes.length===next.bytesRead&&next.file.sha256===expectedSha256,'CSV_RECEIVING_MCP_CHUNK_CHANGED');
      chunks.push(bytes);readId=next.readId;offset=next.nextOffset;
    }
    const resumed=Buffer.concat(chunks);
    must(resumed.length===first.file.bytes&&digest(resumed)===expectedSha256,'CSV_RECEIVING_MCP_RESUME_CHANGED');
    await putOnce(join(input.outputDirectory,'agent-results.csv'),resumed);
    await mcp.close();mcp=null;
    const agentDelivery=await GeocodeBatchDelivery.open(join(workspaceDirectory,'batch-deliveries',agentExport.exportId));
    const agentReceived=await receiveDelivery(agentDelivery,join(input.outputDirectory,'agent-delivery'));
    await stage('original-mcp-batch-tools-and-restarted-file-receiving',{
      tools:8,toolCalls,batchId:mcpReview.batchId,exportId:agentExport.exportId,identity:agentExport.manifest.identity,
      sourceSha256:sourceView.sourceSha256,reviewSha256:mcpReview.reviewSha256,responseSha256:source.responseSha256,
      received:agentReceived,resumedFile:{name:'results.csv',bytes:resumed.length,sha256:expectedSha256,firstBytes:64}});
    const providerDirectory=resolve(dirname(driver),'..');
    const managedSelection=await prepareGeocodeManagedSelection({workspaceDirectory,sourceDirectory:providerDirectory});
    const selectionPath=join(input.outputDirectory,'managed-selection.json');
    await putOnce(selectionPath,jsonBytes(managedSelection));
    const firstManaged=await managedRun({cli,workspace:workspaceDirectory,sourceDirectory:providerDirectory,
      selectionPath,selection:managedSelection,batchId,exportId,environment});
    const secondManaged=await managedRun({cli,workspace:workspaceDirectory,sourceDirectory:providerDirectory,
      selectionPath,selection:managedSelection,batchId,exportId,environment});
    must(firstManaged.instanceId!==secondManaged.instanceId&&firstManaged.sourceFiles===15,'CSV_RECEIVING_MANAGED_REOPEN_CHANGED');
    await stage('original-managed-operator-stop-and-reopen',{first:firstManaged,second:secondManaged});
    report.outcome='COMPLETE';report.finishedAt=new Date().toISOString();
    await writeJson(reportPath,report);return report;
  }catch(error){
    report.outcome='INCOMPLETE';report.error={code:error.code??'CSV_RECEIVING_FAILED',message:String(error.message).slice(0,500)};
    await writeJson(reportPath,report).catch(()=>{});throw error;
  }finally{
    await mcp?.close().catch(()=>{});
    for(const service of customers)await service.close().catch(()=>{});
    await browser?.close().catch(()=>{});
    if(operator)await operator.close();else if(workspace)await workspace.close();
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=argumentsOf(process.argv.slice(2)),inputPath=resolve(args['--input']),record=resolve(args['--record']);
  const inputBytes=await pinned(inputPath,args['--input-sha256']);
  await receiveCsvWorkshare({input:JSON.parse(inputBytes),inputBytes,inputPath,record});
}
