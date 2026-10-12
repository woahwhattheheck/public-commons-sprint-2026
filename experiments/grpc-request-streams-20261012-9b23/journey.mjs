#!/usr/bin/env node
// MIT. One retained native request-stream, merchant-agent, editor and customer operation.
import assert from 'node:assert/strict';
import {readFile, writeFile, open, link, unlink, mkdir, readdir, lstat, realpath, rename, symlink, access} from 'node:fs/promises';
import {join, resolve, dirname, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID, randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';

const OPERATION='SCF-GRPC-REQUEST-STREAM-20261012-9B23';
const flags=new Map();
for(let i=2;i<process.argv.length;i+=2){
  assert(process.argv[i]?.startsWith('--')&&process.argv[i+1]&&!flags.has(process.argv[i]),'Use unique --name value arguments.');
  flags.set(process.argv[i],process.argv[i+1]);
}
const need=name=>resolve(assertValue(flags.get(name),'Missing '+name));
function assertValue(value,message){assert(value,message);return value;}
const sourceRoot=need('--source'),selectionPath=need('--selection'),workRoot=need('--work-root');
const modules=need('--node-modules'),chrome=need('--chrome'),playwrightPath=need('--playwright');
const mode=flags.get('--phase')??'all';assert(['all','core','browser'].includes(mode));
const PREFIX='stellar/scf-starforge-20261009/',GRPC=PREFIX+'sf30-seller-sdk/grpc/',MCP='stellar-forge/mcp-merchant-operator/';
const UPLOAD='/forge.requeststreams.RecordBatch/Upload',EXCHANGE='/forge.requeststreams.RecordBatch/Exchange';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):
  Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const pretty=value=>JSON.stringify(value,null,2)+'\n',now=()=>new Date().toISOString();
const load=path=>import(pathToFileURL(join(sourceRoot,path)).href);
const exists=async path=>access(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
const json=async path=>JSON.parse(await readFile(path,'utf8'));
async function syncDirectory(path){
  const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}
}
async function save(path,value){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=path+'.'+randomUUID()+'.part',handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(Buffer.isBuffer(value)?value:pretty(value));await handle.sync();}
  finally{await handle.close();}
  await rename(temp,path);await syncDirectory(dirname(path));return path;
}
async function retainOriginal(path,bytes){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(await exists(path)){assert.deepEqual(await readFile(path),bytes,'Retain the first original bytes: '+path);return;}
  const temp=path+'.'+randomUUID()+'.part',handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await link(temp,path);}
  catch(issue){if(issue.code!=='EEXIST')throw issue;assert.deepEqual(await readFile(path),bytes);}
  finally{await unlink(temp);}
  await syncDirectory(dirname(path));
}
await mkdir(workRoot,{recursive:true,mode:0o700});
const resultPath=join(workRoot,'result.json');
let result=await exists(resultPath)?await json(resultPath):{
  schema:'stellar-forge.grpc-request-stream-native-journey.v1',operation:OPERATION,
  runId:randomUUID(),startedAt:now(),state:'STARTED',phases:{},refs:{},calls:{},sessions:[],
};
assert.equal(result.operation,OPERATION);
if(result.state==='COMPLETE'){
  if(process.env.SWARM_NATIVE_RECORD&&result.nativeCheckpoint?.state!=='complete'){
    result.nativeCheckpoint=await originalCheckpoint('request-stream-complete-receiving');
    await save(join(workRoot,'checkpoint-receipt.json'),result.nativeCheckpoint);await save(resultPath,result);
  }
  console.log(pretty(result));process.exit(0);
}
if(mode==='browser')assert(result.coreComplete,'Complete the existing core phases before the browser-only continuation.');
const session={id:randomUUID(),startedAt:now(),phase:mode,counts:null,closed:{}};
result.sessions.push(session);result.state='STARTED';delete result.error;
const checkpoint=()=>save(resultPath,result);
const id=name=>result.refs[name]??=(randomUUID());
async function step(name,fn){
  if(result.phases[name]?.state==='COMPLETE')return result.phases[name].value;
  result.phases[name]={state:'STARTED',startedAt:now()};await checkpoint();
  const value=await fn();
  result.phases[name]={...result.phases[name],state:'COMPLETE',finishedAt:now(),value};
  await checkpoint();console.log(JSON.stringify({phase:name,...value}));return value;
}
async function child(command,args,options={}){
  return new Promise((done,reject)=>{
    const running=spawn(command,args,{stdio:['ignore','pipe','pipe'],...options});
    let stdout='',stderr='';const timer=setTimeout(()=>running.kill('SIGTERM'),120000);
    running.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>32*1024*1024)running.kill('SIGTERM');});
    running.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-65536);});
    running.once('error',error=>{clearTimeout(timer);reject(error);});
    running.once('close',(code,signal)=>{clearTimeout(timer);code===0?done({stdout,stderr}):
      reject(Object.assign(Error('Native child ended: '+String(code??signal)+' '+stderr),{code:'NATIVE_CHILD_FAILED'}));});
  });
}
async function originalCheckpoint(label){
  if(!process.env.SWARM_NATIVE_RECORD||!process.env.SWARM_NATIVE_HOST_ROOT)return null;
  const names=['result.json','executed-source.json'];
  for(const name of ['inputs','workspace','downloads','captures','operator'])if(await exists(join(workRoot,name)))names.push(name);
  const code='import json,os,sys\nfrom pathlib import Path\nsys.path.insert(0,os.environ["SWARM_NATIVE_HOST_ROOT"])\nfrom native_artifact_checkpoints import capture\nprint(json.dumps(capture(Path(os.environ["SWARM_NATIVE_RECORD"]),sys.argv[1],json.loads(sys.argv[2]),label=sys.argv[3])))\n';
  const value=await child('python3',['-B','-c',code,label+'-'+randomUUID(),JSON.stringify(names),label],{cwd:workRoot});
  const receipt=JSON.parse(value.stdout.trim().split('\n').at(-1));assert.equal(receipt.state,'complete');return receipt;
}
let upstream,workspace,merchant,client,browser,context,error;
let cliMain,downloadGrpcExport,source,base,records,normalized,contract;
const environment={...process.env,GRPC_REQUEST_STREAM_DEMO_AUTHORIZATION:randomBytes(24).toString('hex'),
  GRPC_REQUEST_STREAM_MCP_TOKEN:randomBytes(32).toString('hex')};
let observedCalls=null,currentNativeCall=null,observationWrite=Promise.resolve();
const callJournalPath=join(workRoot,'operator','native-calls.json');
const callsNow=()=>observedCalls?.length??result.applicationCalls??0;
async function loadCallObservations(){
  if(!await exists(callJournalPath)){observedCalls=[];return;}
  const journal=await json(callJournalPath);
  assert.equal(journal.schema,'stellar-forge.grpc-native-call-observations.v1');
  assert.equal(journal.operation,OPERATION);assert.equal(journal.runId,result.runId);
  assert(Array.isArray(journal.calls));const ids=new Set();
  for(const entry of journal.calls){
    assert(typeof entry.id==='string'&&!ids.has(entry.id));ids.add(entry.id);
    assert([UPLOAD,EXCHANGE].includes(entry.method));assert(typeof entry.sessionId==='string');
    assert.equal(result.refs['call-'+entry.name],entry.operationId,'Keep the observed original call UUID.');
  }
  observedCalls=journal.calls;
}
function observeNativeCall(entry){
  const binding=currentNativeCall;
  const writing=observationWrite.then(async()=>{
  const observation={id:randomUUID(),sessionId:session.id,observedAt:now(),
    name:binding?.name??null,operationId:binding?.operationId??null,
    method:entry.method,sessionCall:entry.number};
  // The endpoint awaits this durable record before processing any application input.
  const next=[...observedCalls,observation];
  await save(callJournalPath,{schema:'stellar-forge.grpc-native-call-observations.v1',
    operation:OPERATION,runId:result.runId,calls:next});
  observedCalls=next;
  assert(binding,'The actual application call must belong to its original dispatch.');
  assert.equal(entry.method,binding.method);
  });
  observationWrite=writing.catch(()=>{});return writing;
}
const privateFile=async(name,bytes)=>save(join(workRoot,name),bytes);
const model=()=>workspace.model;
const mcp=(name,args={})=>client.call('merchant_grpc_'+name,{workspace:'request',...args},{timeoutMs:60000});
async function full(value,name){
  if(value.state!=='COMPLETE_RESULT_RETAINED')return value;
  const delivery=value.delivery;
  const received=await downloadGrpcExport({client,exportId:delivery.exportId,
    expectedManifestSha256:delivery.manifestFile.sha256,
    directory:join(workRoot,'downloads',name+'-'+delivery.exportId),chunkSize:196608});
  return json(join(received.directory,'grpc-result.json'));
}
async function nativeCall(name,method,input,{cancelAfterProgress=false}={}){
  const operationId=id('call-'+name);await checkpoint();
  const earlier=await model().readAttempt({id:operationId});
  if(earlier){
    result.calls[name]={...result.calls[name],operationId,phase:earlier.phase,
      responseSha256:earlier.responseSha256,inputSha256:earlier.inputSha256,
      requestStream:earlier.requestStream,recovered:true};
    await checkpoint();return earlier;
  }
  assert(!observedCalls.some(entry=>entry.operationId===operationId),
    'An observed native call must retain its original attempt before any receiving continuation.');
  result.calls[name]={operationId,phase:'DISPATCHING',startedAt:now()};await checkpoint();
  const before=upstream.counts().receivedMessages;
  assert.equal(currentNativeCall,null);currentNativeCall={name,operationId,method};
  const pending=mcp('call',{revision:result.refs.base,operationId,method,input});
  pending.catch(()=>{});
  let observed;
  try{
    if(cancelAfterProgress){
      const until=Date.now()+10000;
      while(upstream.counts().receivedMessages<before+2&&Date.now()<until)await pause(5);
      assert(upstream.counts().receivedMessages>=before+2,'Observe original native progress before cancellation.');
      const cancelled=await mcp('cancel_call',{operationId});assert(cancelled.cancellationRequested);
    }
    observed=await full(await pending,'call-'+name);
  }catch(issue){
    await mcp('cancel_call',{operationId}).catch(()=>{});
    await pending.catch(()=>{});throw issue;
  }finally{currentNativeCall=null;}
  assert.equal(observed.id,operationId);
  result.calls[name]={operationId,phase:observed.phase,responseSha256:observed.responseSha256,
    inputSha256:observed.inputSha256,requestStream:observed.requestStream,
    response:observed.output?.type==='grpc-ndjson'?{
      records:observed.output.records,bytes:observed.output.bytes,sha256:observed.output.sha256,
      complete:observed.output.complete,grpcCode:observed.output.grpcCode}:undefined};
  session.counts=upstream.counts();await checkpoint();return observed;
}
function inputDone(value,messages){
  assert.equal(value.phase,'COMPLETED');assert.equal(value.requestSeries.messages,messages);
  assert.equal(value.requestStream.writtenMessages,messages);
  assert.equal(value.requestStream.halfClosed,true);
  assert.equal(value.requestStream.terminalObserved,true);
  assert.equal(value.requestStream.grpcCode,0);
}
async function retainedStream(name,attempt){
  const exported=await mcp('export',{kind:'stream',operationId:attempt.id});
  const options={client,exportId:exported.exportId,expectedManifestSha256:exported.manifestFile.sha256,
    directory:join(workRoot,'downloads','stream-'+name),chunkSize:196608};
  const received=await downloadGrpcExport(options),again=await downloadGrpcExport(options);
  assert.equal(received.exportId,again.exportId);
  const bytes=await readFile(join(received.directory,'grpc-stream.ndjson'));
  assert.equal(hash(bytes),attempt.output.sha256);assert.equal(bytes.length,attempt.output.bytes);
  const values=bytes.length?bytes.toString('utf8').trimEnd().split('\n').map(line=>JSON.parse(line)):[];
  assert.equal(values.length,attempt.output.records);
  return {values,exportId:received.exportId,bytes:bytes.length,sha256:hash(bytes),directory:received.directory};
}
try{
  await loadCallObservations();
  const selection=await json(selectionPath);assert.equal(selection.operation,OPERATION);
  if(process.env.SWARM_NATIVE_RECORD){
    const nativeRequest=await json(join(process.env.SWARM_NATIVE_RECORD,'request.json'));
    assert.equal(nativeRequest.intent.operation_id,OPERATION);
    assert.equal(await realpath(nativeRequest.intent.project),await realpath(workRoot));
  }
  assert(/^[a-f0-9]{40}$/.test(selection.commit));assert(selection.files&&typeof selection.files==='object');
  const inventory=[];
  for(const [name,expected] of Object.entries(selection.files).sort(([a],[b])=>a.localeCompare(b))){
    assert(!name.startsWith('/')&&!name.split('/').includes('..')&&!name.includes('\\'));
    const path=join(sourceRoot,name),info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink());
    const bytes=await readFile(path),sha=blob(bytes);assert.equal(sha,expected,name);
    inventory.push({path:name,sha,bytes:bytes.length,sha256:hash(bytes)});
  }
  const link=join(sourceRoot,'node_modules');
  if(await exists(link))assert.equal(await realpath(link),await realpath(modules));
  else await symlink(modules,link,'dir');
  result.source={commit:selection.commit,scope:selection.scope??'complete-repository',
    files:inventory.length,bytes:inventory.reduce((sum,row)=>sum+row.bytes,0),sha256:hash(canonical(inventory))};
  await privateFile('executed-source.json',{...result.source,files:inventory});
  await checkpoint();
  const [{startRequestStreamExample},{compileProtoSource},{prepareGrpcInput,grpcOperationSchema},
    {startGrpcWorkspace},{main},{initializeGrpcWorkspaceMerchant},{startMerchantMcp},
    {openMerchantFileClient},downloadModule]=await Promise.all([
      load(GRPC+'examples/request-stream-server.mjs'),load(GRPC+'proto.mjs'),load(GRPC+'request-series.mjs'),
      load(GRPC+'workspace/server.mjs'),load(GRPC+'cli.mjs'),load(MCP+'config.mjs'),load(MCP+'serve.mjs'),
      load(MCP+'retained-download.mjs'),load(MCP+'grpc-workspace-download.mjs'),
    ]);
  cliMain=main;({downloadGrpcExport}=downloadModule);
  for(const name of ['inputs','downloads','captures','operator'])await mkdir(join(workRoot,name),{recursive:true,mode:0o700});
  if(mode!=='browser'){
    upstream=await startRequestStreamExample({port:result.refs.servicePort??0,
      authorization:environment.GRPC_REQUEST_STREAM_DEMO_AUTHORIZATION,observeCall:observeNativeCall});
    result.refs.servicePort=Number(upstream.target.split(':').at(-1));await checkpoint();
  }
  source=await json(join(sourceRoot,GRPC+'examples/request-stream-source.json'));
  source.target='127.0.0.1:'+result.refs.servicePort;
  const plan=await json(join(sourceRoot,GRPC+'examples/request-stream-plan.json'));
  records={messages:Array.from({length:128},(_,index)=>({
    sequence:String(9007199254740993n+BigInt(index)),
    payload:Buffer.alloc(1024,index%256).toString('base64'),
    balances:{reserve:index%2?'9007199254740993':'-9007199254740993'},
    ...(index%2?{customer_id:'9223372036854775806'}:{account_id:'account-'+index,note:''}),
    delay_ms:1,
  }))};
  await privateFile('inputs/request-sequence.json',records);await privateFile('inputs/source.json',source);
  await privateFile('inputs/plan.json',plan);
  workspace=await startGrpcWorkspace({stateDirectory:join(workRoot,'workspace'),port:0,sellerPort:0,operationsPort:0,
    releaseRuntime:{port:0},env:environment});
  const urlFile=join(workRoot,'operator','console-url.txt');await privateFile('operator/console-url.txt',Buffer.from(workspace.url+'\n'));
  if(!result.refs.base){
    const state=await model().state(),current=state.currentRevision??state.current?.revision;
    if(current){
      const retained=await model().open({revision:current});
      assert.equal(retained.title,'Native request-stream receiving');base=retained;
    }else base=await model().capture({directory:join(sourceRoot,GRPC+'examples/proto'),
      entrypoints:['request-streams.proto'],source,plan,baseRevision:null,title:'Native request-stream receiving'});
    result.refs.base=base.id;await checkpoint();
  }
  base=await model().open({revision:result.refs.base});
  assert.equal(base.protoSource.sha256,(upstream?.protoSource??base.protoSource).sha256);
  contract=compileProtoSource(base.protoSource);normalized=prepareGrpcInput(contract,UPLOAD,records,{limits:base.source.limits});
  await privateFile('inputs/proto-source.json',base.protoSource);
  const current=await model().state();
  if((current.currentRevision??current.current?.revision)!==base.id)
    await model().checkout({revision:base.id,baseRevision:current.currentRevision??current.current?.revision});
  const connectionPath=join(workRoot,'operator','connection.json');
  if(!await exists(connectionPath))await privateFile('operator/connection.json',{
    schema:'stellar-forge.grpc-workspace-connection.v1',workspaces:{request:{consoleUrlFile:urlFile}}});
  const configPath=join(workRoot,'operator','merchant-agent','merchant-mcp.json');
  if(!await exists(configPath))await initializeGrpcWorkspaceMerchant({
    directory:join(workRoot,'operator','merchant-agent'),connection:connectionPath});
  merchant=await startMerchantMcp({configPath,port:0,tokenEnv:'GRPC_REQUEST_STREAM_MCP_TOKEN',environment});
  client=await openMerchantFileClient({url:merchant.url,tokenEnv:'GRPC_REQUEST_STREAM_MCP_TOKEN',environment});
  if(mode!=='browser'){
    await step('native-source-and-request-preview',async()=>{
      const schema=await mcp('method',{revision:base.id,method:UPLOAD});
      assert(schema.requestSeries&&schema.requestMessage);assert.equal(schema.method.requestStream,true);
      const preview=await full(await mcp('validate_input',{revision:base.id,method:UPLOAD,input:records}),'preview');
      assert.equal(preview.messages,128);assert.deepEqual(preview.input,normalized.value);
      assert.equal(preview.requestBytes,normalized.requestBytes);assert.equal(preview.requestJsonBytes,normalized.requestJsonBytes);
      const command=await cliMain(['validate-request','--proto',join(workRoot,'inputs/proto-source.json'),
        '--source',join(workRoot,'inputs/source.json'),'--method',UPLOAD,
        '--input',join(workRoot,'inputs/request-sequence.json')],{stdout:{write(){}}});
      assert.equal(command.requestBytes,preview.requestBytes);assert.deepEqual(command.input,preview.input);
      await assert.rejects(()=>model().validateInput({revision:base.id,method:UPLOAD,
        input:{messages:[{sequence:'18446744073709551616'}]}}),issue=>issue.code==='grpc_request_invalid');
      const review=await mcp('review',{revision:base.id});assert(review.channelReady);
      assert.equal(upstream.counts().calls,0);
      return {revision:base.id,protoSha256:base.protoSource.sha256,messages:128,
        requestBytes:preview.requestBytes,requestJsonBytes:preview.requestJsonBytes,cli:true,channelReady:true};
    });
    await step('native-upload-and-original-id',async()=>{
      const value=await nativeCall('upload',UPLOAD,records);inputDone(value,128);
      assert.deepEqual(value.output.records,normalized.messages);assert.equal(value.output.messages,'128');
      assert.equal(value.output.payload_bytes,String(128*1024));
      assert(value.requestStream.backpressureWaits>0,'The native Writable must actually apply backpressure.');
      const before=upstream.counts().calls,recovered=await full(await mcp('call',{revision:base.id,
        operationId:value.id,method:UPLOAD,input:records}),'upload-repeat');
      assert.equal(recovered.responseSha256,value.responseSha256);assert.equal(upstream.counts().calls,before);
      return {operationId:value.id,requestStream:value.requestStream,responseSha256:value.responseSha256};
    });
    await step('bidirectional-empty-nonok-and-cancel',async()=>{
      const exchange=await nativeCall('exchange',EXCHANGE,records);inputDone(exchange,128);
      assert(exchange.output.complete);const output=await retainedStream('exchange',exchange);
      assert.deepEqual(output.values,normalized.messages);
      const emptyUpload=await nativeCall('empty-upload',UPLOAD,{messages:[]});inputDone(emptyUpload,0);
      assert.equal(emptyUpload.output.messages,'0');
      const emptyExchange=await nativeCall('empty-exchange',EXCHANGE,{messages:[]});inputDone(emptyExchange,0);
      assert(emptyExchange.output.complete);assert.equal(emptyExchange.output.records,0);
      const rejected=await nativeCall('nonok',EXCHANGE,{messages:[
        {sequence:'1',payload:'AQ=='},{sequence:'2',reject:true},{sequence:'3'}]});
      assert.equal(rejected.phase,'OUTCOME_UNCONFIRMED');assert.equal(rejected.output.complete,false);
      assert.equal(rejected.output.grpcCode,14);assert(rejected.output.records>=1);
      const failedPrefix=await retainedStream('nonok',rejected);
      assert.equal(failedPrefix.values[0].sequence,'1');
      const cancelled=await nativeCall('cancel',EXCHANGE,{messages:Array.from({length:32},(_,index)=>({
        sequence:String(index+1),payload:'Ag==',delay_ms:40}))},{cancelAfterProgress:true});
      assert.equal(cancelled.phase,'OUTCOME_UNCONFIRMED');assert.equal(cancelled.output.complete,false);
      assert.equal(cancelled.output.grpcCode,1);assert(cancelled.output.records>=1);
      const cancelledPrefix=await retainedStream('cancel',cancelled);
      return {exchange:{id:exchange.id,records:output.values.length,sha256:output.sha256,
        backpressureWaits:exchange.requestStream.backpressureWaits},
        empty:[emptyUpload.id,emptyExchange.id],nonOK:{id:rejected.id,grpcCode:rejected.output.grpcCode,records:failedPrefix.values.length},
        cancelled:{id:cancelled.id,grpcCode:cancelled.output.grpcCode,records:cancelledPrefix.values.length}};
    });
    await step('original-terminal-recovery',async()=>{
      const operationId=id('call-upload'),attemptPath=join(workRoot,'workspace','attempts',operationId+'.json');
      const outputPath=join(workRoot,'workspace','attempts',operationId+'.output');
      const recovery=join(workRoot,'operator','terminal-recovery'),journalPath=join(recovery,'journal.json');
      const attemptBackup=join(recovery,'original-attempt.json'),outputBackup=join(recovery,'original-output.json');
      let journal;
      if(await exists(journalPath))journal=await json(journalPath);
      else{
        const attemptBytes=await readFile(attemptPath),outputBytes=await readFile(outputPath);
        const attempt=JSON.parse(attemptBytes),output=JSON.parse(outputBytes);
        assert.equal(attempt.id,operationId);assert.equal(output.id,operationId);
        assert.equal(attempt.fingerprint,output.fingerprint);
        assert.equal(attempt.responseSha256,output.sha256);assert.equal(hash(canonical(output.output)),output.sha256);
        await retainOriginal(attemptBackup,attemptBytes);await retainOriginal(outputBackup,outputBytes);
        journal={schema:'stellar-forge.grpc-terminal-recovery.v1',operation:OPERATION,runId:result.runId,
          operationId,fingerprint:attempt.fingerprint,attemptSha256:hash(attemptBytes),
          outputSha256:hash(outputBytes),state:'ORIGINALS_RETAINED',createdAt:now()};
        await save(journalPath,journal);
      }
      assert.equal(journal.schema,'stellar-forge.grpc-terminal-recovery.v1');
      assert.equal(journal.operation,OPERATION);assert.equal(journal.runId,result.runId);assert.equal(journal.operationId,operationId);
      const originalAttempt=await readFile(attemptBackup),originalOutput=await readFile(outputBackup);
      assert.equal(hash(originalAttempt),journal.attemptSha256);assert.equal(hash(originalOutput),journal.outputSha256);
      assert.equal(JSON.parse(originalAttempt).fingerprint,journal.fingerprint);
      assert.equal(JSON.parse(originalOutput).fingerprint,journal.fingerprint);
      // A resumed phase first restores the durable originals, even if the process died during an injection.
      await save(outputPath,originalOutput);await save(attemptPath,originalAttempt);
      const before=callsNow();
      if(journal.state!=='COMPLETE'){
        try{
          journal.state='INJECTING_METADATA';await save(journalPath,journal);
          const interrupted=JSON.parse(originalAttempt);interrupted.phase='OUTCOME_UNCONFIRMED';
          interrupted.error='LOCAL_FINALIZATION_INTERRUPTED';interrupted.grpcCode=13;
          interrupted.nextAction='Earlier failure guidance';delete interrupted.requestStream;
          await save(attemptPath,interrupted);
          const recovered=await full(await mcp('attempt',{operationId}),'recovered-upload');
          inputDone(recovered,128);
          for(const key of ['error','grpcCode','nextAction'])assert.equal(Object.hasOwn(recovered,key),false);
          journal.state='INJECTING_CHANGED_TERMINAL';await save(journalPath,journal);
          const changed=JSON.parse(originalOutput);changed.output.messages='129';changed.sha256=hash(canonical(changed.output));
          await save(outputPath,changed);
          await assert.rejects(()=>model().readAttempt({id:operationId}),issue=>issue.code==='GRPC_CALL_OUTPUT_CHANGED');
          assert.equal((await json(attemptPath)).responseSha256,JSON.parse(originalAttempt).responseSha256);
        }finally{
          await save(outputPath,originalOutput);await save(attemptPath,originalAttempt);
          journal.state='ORIGINALS_RESTORED';await save(journalPath,journal);
        }
      }
      const final=await model().readAttempt({id:operationId});inputDone(final,128);
      assert.equal(callsNow(),before);
      const value={operationId,responseSha256:final.responseSha256,firstResultPreserved:true,
        staleFailureCleared:true,additionalCalls:0,originalAttemptSha256:journal.attemptSha256,
        originalOutputSha256:journal.outputSha256};
      journal.state='COMPLETE';journal.value=value;journal.finishedAt=now();await save(journalPath,journal);
      return value;
    });
  }
  if(mode!=='core')await step('industrial-sequence-editor',async()=>{
    const playwright=await import(pathToFileURL(join(playwrightPath,'index.mjs')).href);
    const profile=join(workRoot,'captures','browser-profile');await mkdir(profile,{recursive:true,mode:0o700});
    browser=await playwright.chromium.launch({executablePath:chrome,headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],env:{...environment,TMPDIR:join(workRoot,'captures')}});
    context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
    const page=await context.newPage(),pageErrors=[];page.on('pageerror',issue=>pageErrors.push(issue.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.goto(workspace.url,{waitUntil:'networkidle'});
    await page.locator('[data-view="methods"]').click();
    const methodCard=page.locator('#method-list .card').filter({hasText:UPLOAD});
    if(await methodCard.count())await methodCard.getByRole('button',{name:'Open method',exact:true}).click();
    else await page.locator('#method-list').getByRole('button',{name:'Open method',exact:true}).first().click();
    await page.locator('#field-form.request-series').waitFor();
    await page.locator('#field-form input[type=file]').setInputFiles(join(workRoot,'inputs/request-sequence.json'));
    await page.waitForFunction(()=>document.querySelector('#field-form .hint')?.textContent.includes('128 messages'));
    assert.equal(await page.locator('#field-form [data-message-index]').count(),20);
    await page.getByRole('button',{name:'Next messages',exact:true}).click();
    await page.locator('#field-form [data-message-index="20"]').click();
    assert.match(await page.getByLabel('Selected request message JSON',{exact:true}).inputValue(),/9007199254741013/);
    const selected=JSON.parse(await page.getByLabel('Selected request message JSON',{exact:true}).inputValue());
    selected.note='Operator reviewed message 21';
    await page.getByLabel('Selected request message JSON',{exact:true}).fill(pretty(selected));
    await page.getByRole('button',{name:'Duplicate message',exact:true}).click();
    await page.getByRole('button',{name:'Move earlier',exact:true}).click();
    await page.getByRole('button',{name:'Remove message',exact:true}).click();
    await page.locator('#validate-input').click();
    await page.waitForFunction(()=>document.querySelector('#request-preview')?.textContent.includes('"messages": 128'));
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download sequence JSON',exact:true}).click();
    const download=await downloadPromise;await download.saveAs(join(workRoot,'captures','editor-request-sequence.json'));
    const edited=await json(join(workRoot,'captures','editor-request-sequence.json'));
    assert.equal(edited.messages.length,128);assert.equal(edited.messages[20].note,'Operator reviewed message 21');
    await page.screenshot({path:join(workRoot,'captures','request-stream-editor-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:join(workRoot,'captures','request-stream-editor-mobile.png'),fullPage:true});
    const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert(dimensions.scroll<=dimensions.width+1,'The complete native editor must fit the narrow viewport.');
    assert.deepEqual(pageErrors,[]);
    await context.close();context=null;await browser.close();browser=null;
    return {messages:128,pageSize:20,editedIndex:20,desktop:[1440,1050],mobile:[390,844],pageErrors,
      sequenceSha256:hash(await readFile(join(workRoot,'captures','editor-request-sequence.json')))};
  });
  if(mode!=='browser'){
    await step('merchant-customer-receiving',async()=>{
      const preparation=id('preparation-base');await checkpoint();
      const prepared=await mcp('prepare',{revision:base.id,operationId:preparation});assert.equal(prepared.id,preparation);
      const exported=await mcp('export',{kind:'customer',preparation});
      const options={client,exportId:exported.exportId,expectedManifestSha256:exported.manifestFile.sha256,
        directory:join(workRoot,'downloads','customer-base'),chunkSize:196608};
      const received=await downloadGrpcExport(options),again=await downloadGrpcExport(options);
      assert.equal(received.exportId,again.exportId);assert.equal(received.nativeFiles.length,7);
      assert.deepEqual(received.nativeFiles,['methods.json','openapi.json','client/seller-client.mjs',
        'client/seller-client.d.mts','client/seller-openapi.json','client/package.json','client/README.md']);
      const sdk=await import(pathToFileURL(join(received.customerDirectory,'seller-client.mjs')).href);
      const request=sdk.buildRequest('upload-records',{body:records},{intentId:id('sdk-intent'),maxAtomic:'25000'});
      assert.equal(new URL(request.url).pathname,'/records/upload');assert.deepEqual(JSON.parse(request.body),records);
      const before=upstream.counts().calls,runtime=await mcp('run',{preparation});
      const origin=new URL(runtime.active.url).origin;
      const preview=await fetch(origin+new URL(request.url).pathname,{method:request.method,headers:request.headers,
        body:request.body,redirect:'error',signal:AbortSignal.timeout(10000)});
      await preview.arrayBuffer();assert.equal(preview.status,402);
      const invalid=await fetch(origin+new URL(request.url).pathname,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({messages:[{sequence:'18446744073709551616'}]}),redirect:'error',signal:AbortSignal.timeout(10000)});
      await invalid.arrayBuffer();assert.equal(invalid.status,400);
      await mcp('stop');assert.equal(upstream.counts().calls,before);
      return {preparation,exportId:exported.exportId,customerFiles:received.nativeFiles,
        originalSDKRequest:true,previewStatus:preview.status,invalidStatus:invalid.status};
    });
    await step('request-policy-upgrade-and-release',async()=>{
      const sourceNext=structuredClone(base.source);sourceNext.limits.requestStream.maxMessages=1;
      let candidate;
      if(result.refs.candidate)candidate=await model().open({revision:result.refs.candidate});
      else{
        const current=await model().state();
        candidate=await model().save({source:sourceNext,protoSource:base.protoSource,plan:{...base.plan,routes:[]},
          baseRevision:current.currentRevision??current.current?.revision,title:'One-message native policy candidate'});
        result.refs.candidate=candidate.id;await checkpoint();
      }
      let current=await model().state();
      if((current.currentRevision??current.current?.revision)!==base.id)
        await model().checkout({revision:base.id,baseRevision:current.currentRevision??current.current?.revision});
      const invalidId=id('upgrade-invalid'),validId=id('upgrade-valid');await checkpoint();
      const rejected=await full(await mcp('upgrade_review',{operationId:invalidId,baseRevision:base.id,
        candidate:{kind:'revision',id:candidate.id},plan:base.plan,title:'One-message native policy'}),'upgrade-invalid');
      assert.equal(rejected.planValidation.valid,false);
      const corrected=structuredClone(base.plan);for(const route of corrected.routes)route.example.messages=route.example.messages.slice(0,1);
      const reviewed=await full(await mcp('upgrade_review',{operationId:validId,baseRevision:base.id,
        candidate:{kind:'revision',id:candidate.id},plan:corrected,title:'One-message native policy'}),'upgrade-valid');
      assert.equal(reviewed.planValidation.valid,true);
      const adopted=await full(await mcp('upgrade_adopt',{operationId:validId,expectedReviewSha256:reviewed.reviewSha256}),'upgrade-adopted');
      const revision=adopted.revision.id;result.refs.adopted=revision;await checkpoint();
      current=await model().state();
      if((current.currentRevision??current.current?.revision)!==revision)
        await model().checkout({revision,baseRevision:current.currentRevision??current.current?.revision});
      const preparation=id('preparation-candidate');await checkpoint();
      await mcp('prepare',{revision,operationId:preparation});
      const exported=await mcp('export',{kind:'customer',preparation});
      const received=await downloadGrpcExport({client,exportId:exported.exportId,
        expectedManifestSha256:exported.manifestFile.sha256,directory:join(workRoot,'downloads','customer-candidate')});
      assert.equal(received.nativeFiles.length,7);
      await mcp('stage',{preparation:result.refs['preparation-base'],releaseId:'request-stream-original'});
      await mcp('stage',{preparation,releaseId:'request-stream-reviewed'});
      const {readReleaseState}=await load(PREFIX+'sf82-seller-pilot/releases.mjs');
      const store=join(workRoot,'workspace','merchant-releases');
      await mcp('release_open');
      let selected=await readReleaseState(store);
      if(selected.active!=='request-stream-original'){
        await mcp('release_activate',{id:'request-stream-original',expectedGeneration:selected.generation,reason:'Original request-stream merchant'});
        selected=await readReleaseState(store);
      }
      await mcp('release_activate',{id:'request-stream-reviewed',expectedGeneration:selected.generation,reason:'Reviewed one-message request policy'});
      selected=await readReleaseState(store);assert.equal(selected.active,'request-stream-reviewed');
      await mcp('release_rollback',{expectedGeneration:selected.generation,reason:'Return to the original reviewed request capacity'});
      selected=await readReleaseState(store);assert.equal(selected.active,'request-stream-original');
      await mcp('release_close');
      return {invalidReview:invalidId,review:validId,reviewSha256:reviewed.reviewSha256,
        candidate:candidate.id,adopted:revision,preparation,customerFiles:received.nativeFiles.length,
        releaseGeneration:selected.generation,active:selected.active,previous:selected.previous};
    });
    result.coreComplete=true;await checkpoint();
  }
  await merchant.close();merchant=null;session.closed.merchant=true;
  await workspace.close();workspace=null;session.closed.workspace=true;
  if(mode!=='browser')await step('original-offline-cli-receiving',async()=>{
    const attempt=await cliMain(['attempt','--state',join(workRoot,'workspace'),'--id',id('call-upload')],{stdout:{write(){}}});
    inputDone(attempt,128);
    const path=join(workRoot,'operator','cli-exchange.ndjson');
    if(!await exists(path))await cliMain(['export-stream','--state',join(workRoot,'workspace'),'--id',id('call-exchange'),'--out',path],{stdout:{write(){}}});
    const expected=result.phases['bidirectional-empty-nonok-and-cancel'].value.exchange;
    assert.equal(hash(await readFile(path)),expected.sha256);
    return {operationId:attempt.id,phase:attempt.phase,streamSha256:expected.sha256};
  });
  if(upstream){session.counts=upstream.counts();await upstream.close();session.closed.upstream=true;assert.equal(upstream.counts().active,0);}
  result.applicationCalls=callsNow();
  assert.equal(Object.keys(result.calls).length,6);assert.equal(result.applicationCalls,6);
  const expectedCalls=new Map(Object.entries(result.calls).map(([name,value])=>[value.operationId,name]));
  assert.equal(expectedCalls.size,6);assert.equal(new Set(observedCalls.map(entry=>entry.operationId)).size,6);
  for(const observation of observedCalls)assert.equal(expectedCalls.get(observation.operationId),observation.name);
  result.nativeCallObservations={path:'operator/native-calls.json',calls:observedCalls.length,
    sha256:hash(await readFile(callJournalPath))};
  result.state=result.phases['industrial-sequence-editor']?.state==='COMPLETE'?'COMPLETE':'CORE_COMPLETE_BROWSER_PENDING';
  result.finishedAt=now();
}catch(issue){
  error=issue;result.state='INTERRUPTED';
  result.error={code:issue.code??issue.name,message:issue.message,stack:String(issue.stack??'').slice(0,10000)};
}finally{
  for(const [name,get] of [['browser',()=>browser],['merchant',()=>merchant],['workspace',()=>workspace],['upstream',()=>upstream]]){
    const resource=get();if(!resource)continue;
    try{if(name==='upstream')session.counts=resource.counts();await resource.close();session.closed[name]=true;}
    catch(issue){session.closed[name]=false;result.closeErrors??=[];result.closeErrors.push({name,code:issue.code??issue.message});error??=issue;}
  }
  result.applicationCalls=callsNow();session.finishedAt=now();
  if(error&&result.state==='COMPLETE')result.state='INTERRUPTED';
  await checkpoint();
  try{
    const receipt=await originalCheckpoint(result.state==='COMPLETE'?'request-stream-complete':'request-stream-continuation');
    if(receipt){result.nativeCheckpoint=receipt;await privateFile('checkpoint-receipt.json',receipt);await checkpoint();}
  }catch(issue){result.checkpointError={code:issue.code??issue.message};result.state='INTERRUPTED';error??=issue;await checkpoint();}
}
console.log(JSON.stringify({operation:OPERATION,runId:result.runId,state:result.state,source:result.source,
  applicationCalls:result.applicationCalls,phases:Object.fromEntries(Object.entries(result.phases).map(([name,value])=>[name,value.state])),
  closed:session.closed,error:result.error,checkpoint:result.nativeCheckpoint?.state}));
if(error)process.exitCode=1;
