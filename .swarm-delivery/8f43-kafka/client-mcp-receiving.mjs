// MIT. Operate the original retained Kafka customer through its Node client and merchant MCP.
// This receiving phase is called while the original Python customer console owns its writer.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, link, rename, unlink } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const SCHEMA='stellar-forge.kafka-client-mcp-receiving.v1';
const OPERATION='SCF-KAFKA-MERCHANT-8F43-20261012';
const NATIVE_SOURCE='d6938e1f333d92670a653f47d136b7d7cfb3abfa';
const CLIENT_SOURCE='49bdf3acba6ac4de762e82249997e106b5c2c6ec';
const ALIAS='original-kafka-customer';
const HEX=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
const stamp=()=>new Date().toISOString();
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function requireValue(value,message) { if(!value)throw new Error(message); }
function parseArgs(argv) {
  const result={};
  for(let i=0;i<argv.length;i+=2) {
    const key=argv[i],value=argv[i+1];
    if(!['--input','--receipts','--product-root','--out'].includes(key)||!value||value.startsWith('--')||Object.hasOwn(result,key.slice(2)))
      throw new Error('Use --input ORIGINAL_BROWSER_INPUT --receipts ORIGINAL_RECEIPTS --product-root REPOSITORY_SOURCE_ROOT --out PRIVATE_RECEIVING_DIRECTORY.');
    result[key.slice(2)]=resolve(value);
  }
  requireValue(Object.keys(result).length===4,'Supply the four original receiving paths.');
  return result;
}
async function privateDirectory(path,{create=false}={}) {
  if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const stat=await lstat(path);
  requireValue(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0&&
    (typeof process.getuid!=='function'||stat.uid===process.getuid())&&await realpath(path)===path,
    'Use the original canonical, private receiving directory: '+path);
  return path;
}
async function sourceDirectory(path) {
  requireValue(await realpath(path)===path&&(await lstat(path)).isDirectory(),'Use the actual canonical source directory.');
  return path;
}
async function readBytes(path,maximum=32*1024*1024,{privateFile=true}={}) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true});
    requireValue(before.isFile()&&before.size<=BigInt(maximum)&&(!privateFile||(before.mode&0o077n)===0n),
      'Retain the complete original regular file within its declared limit: '+path);
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
    requireValue(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&bytes.length===Number(before.size),
      'The original receiving file changed while it was read: '+path);
    return bytes;
  } finally {await handle.close();}
}
async function optionalBytes(path,maximum) {
  try{return await readBytes(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function syncDirectory(path) {
  const handle=await open(path,constants.O_RDONLY);
  try{await handle.sync();}finally{await handle.close();}
}
async function publish(path,bytes,{replace=false}={}) {
  const temporary=join(dirname(path),'.client-mcp-'+randomUUID()+'.pending');
  let handle,owned,primary;
  try {
    handle=await open(temporary,'wx',0o600);owned=await handle.stat({bigint:true});
    await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    if(replace) {
      const existing=await optionalBytes(path,64*1024*1024);
      if(existing?.equals(bytes))return;
      await rename(temporary,path);
    } else {
      try{await link(temporary,path);}
      catch(error){if(error.code!=='EEXIST')throw error;requireValue((await readBytes(path,64*1024*1024)).equals(bytes),'Preserve the original receiving selection: '+path);}
    }
    await syncDirectory(dirname(path));
  } catch(error){primary=error;throw error;}
  finally {
    let cleanup;
    if(handle)try{await handle.close();}catch(error){cleanup=error;}
    if(owned)try {
      const current=await lstat(temporary,{bigint:true});
      if(current.dev===owned.dev&&current.ino===owned.ino)await unlink(temporary);
    } catch(error){if(error.code!=='ENOENT')cleanup??=error;}
    if(cleanup&&!primary)throw cleanup;
  }
}
function canonical(value,NumberClass) {
  if(value instanceof NumberClass)return {$kafkaNumber:value.source};
  if(Array.isArray(value))return value.map(item=>canonical(item,NumberClass));
  if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key],NumberClass)]));
  return value;
}
async function runChild(file,args,{signal,environment=process.env}={}) {
  signal?.throwIfAborted();
  const child=spawn(process.execPath,[file,...args],{stdio:['ignore','pipe','pipe'],env:environment});
  let out=[],err=[],outBytes=0,errBytes=0,spawnError,overflow=false;
  const abort=()=>{if(child.exitCode===null)child.kill('SIGTERM');};
  signal?.addEventListener('abort',abort);
  const collect=(target,kind)=>(chunk)=>{
    if(kind==='out')outBytes+=chunk.length;else errBytes+=chunk.length;
    if(outBytes+errBytes>1024*1024){overflow=true;child.kill('SIGTERM');return;}
    target.push(chunk);
  };
  child.stdout.on('data',collect(out,'out'));child.stderr.on('data',collect(err,'err'));
  child.on('error',error=>{spawnError=error;});
  if(signal?.aborted)abort();
  try {
    const ended=await new Promise(resolve=>child.once('close',(code,childSignal)=>resolve({code,signal:childSignal})));
    signal?.throwIfAborted();
    if(spawnError)throw spawnError;
    requireValue(!overflow&&ended.code===0,'The original Node command did not complete: '+basename(file)+' (exit '+ended.code+'). '+Buffer.concat(err).toString('utf8').slice(-4000));
    return {exitCode:ended.code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')};
  } finally {signal?.removeEventListener('abort',abort);}
}
async function prefix(path,length) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true}),bytes=Buffer.alloc(Math.min(length,Number(before.size)));
    let at=0;
    while(at<bytes.length){const got=await handle.read(bytes,at,bytes.length-at,at);requireValue(got.bytesRead>0,'The retained file prefix ended early.');at+=got.bytesRead;}
    const after=await handle.stat({bigint:true});
    requireValue(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,
      'The retained file changed while its original prefix was checked.');
    return bytes;
  } finally {await handle.close();}
}

export async function receiveKafkaClientAndMcp(argv=process.argv.slice(2)) {
  const args=parseArgs(argv),root=dirname(args.input);
  requireValue(basename(args.input)==='browser-input.json'&&args.receipts===join(root,'receipts')&&args.out===join(root,'client-mcp'),
    'Attach this phase to the original customer browser input, receipts and client-mcp directory.');
  await privateDirectory(root);await privateDirectory(args.receipts);await sourceDirectory(args['product-root']);
  await privateDirectory(args.out,{create:true});
  const component=join(args['product-root'],'stellar/scf-starforge-20261009');
  const kafka=join(component,'sf30-seller-sdk/kafka');
  const merchant=join(args['product-root'],'stellar-forge/mcp-merchant-operator');
  const [
    clientModule,setupModule,serveModule,fileClientModule,downloadModule,leaseModule,catalogModule
  ]=await Promise.all([
    import(pathToFileURL(join(kafka,'client.mjs')).href),
    import(pathToFileURL(join(kafka,'merchant-setup.mjs')).href),
    import(pathToFileURL(join(merchant,'serve.mjs')).href),
    import(pathToFileURL(join(merchant,'retained-download.mjs')).href),
    import(pathToFileURL(join(kafka,'merchant-download.mjs')).href),
    import(pathToFileURL(join(component,'merchant-fleet-gateway/state-lease.mjs')).href),
    import(pathToFileURL(join(kafka,'merchant-catalog.mjs')).href)
  ]);
  const {KafkaWorkspaceClient,KafkaJsonNumber,parseKafkaJson,stringifyKafkaJson,inspectKafkaDownload}=clientModule;
  const {initializeKafkaWorkspaceMerchant}=setupModule;
  const {startMerchantMcp}=serveModule;
  const {openMerchantFileClient}=fileClientModule;
  const {inspectKafkaMerchantExport,downloadKafkaMerchantExport,inspectKafkaMerchantDownload}=downloadModule;
  for(const value of [KafkaWorkspaceClient,initializeKafkaWorkspaceMerchant,startMerchantMcp,openMerchantFileClient,
    inspectKafkaMerchantExport,downloadKafkaMerchantExport,inspectKafkaMerchantDownload])
    requireValue(typeof value==='function','Retain the complete joined native client and merchant provider source.');
  const encode=value=>Buffer.from(stringifyKafkaJson(value,2)+'\n');
  const same=(a,b)=>JSON.stringify(canonical(a,KafkaJsonNumber))===JSON.stringify(canonical(b,KafkaJsonNumber));
  const equal=(a,b,message)=>requireValue(same(a,b),message);
  const json=async(path,maximum)=>parseKafkaJson(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(path,maximum)));
  const optionalJson=async path=>{const bytes=await optionalBytes(path,32*1024*1024);return bytes?parseKafkaJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes)):null;};
  const writeJson=(path,value,replace=false)=>publish(path,encode(value),{replace});
  let lease,client,mcp,remote,signalExit=0,primary,final;
  const controller=new AbortController(),signal=controller.signal;
  const interrupt=()=>{signalExit ||=130;controller.abort();};
  const terminate=()=>{signalExit ||=143;controller.abort();};
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  const journalPath=join(args.out,'journal.json');
  let journal={schema:SCHEMA,operation:OPERATION,status:'STARTING',updatedAt:stamp(),steps:{},files:{},tools:{}};
  const checkpoint=async(name,result)=>{
    lease.assertHeld();journal.steps[name]={completedAt:stamp(),result};journal.updatedAt=stamp();
    await writeJson(journalPath,journal,true);
  };
  try {
    lease=await leaseModule.acquireStateLease(args.out);
    const retainedJournal=await optionalJson(journalPath);
    if(retainedJournal){requireValue(retainedJournal.schema===SCHEMA&&retainedJournal.operation===OPERATION,'Retain the original receiving journal.');journal=retainedJournal;}
    const input=await json(args.input),originalBytes=await readBytes(join(root,'receiving-input.json'),4*1024*1024);
    const original=parseKafkaJson(new TextDecoder('utf-8',{fatal:true}).decode(originalBytes));
    requireValue(input.operation===OPERATION&&original.operation===OPERATION&&input.sourcePin===NATIVE_SOURCE&&original.sourcePin===NATIVE_SOURCE,
      'Use the frozen original Kafka customer operation and source.');
    requireValue(input.workspace===join(root,'customer')&&input.connectionFile===join(root,'customer-console.connection')&&HEX.test(input.bindingSha256),
      'Use the original managed customer workspace and connection.');
    await privateDirectory(input.workspace);
    const names=['connection','inspection','capture','keyed-capture','audit-projection','current-projection',
      'audit-mapping','current-mapping','audit-build','current-build','audit-query','current-query','comparison','browser-selected-event'];
    const receipts=Object.fromEntries(await Promise.all(names.map(async name=>[name,await json(join(args.receipts,name+'.json'))])));
    const connection=receipts.connection,inspection=receipts.inspection,capture=receipts.capture,audit=receipts['audit-projection'];
    const mapping=receipts['audit-mapping'],build=receipts['audit-build'],currentBuild=receipts['current-build'];
    const event=receipts['browser-selected-event'],query=receipts['audit-query'],comparison=receipts.comparison;
    requireValue(capture.status==='COMPLETE'&&receipts['keyed-capture'].status==='COMPLETE'&&capture.id===input.capture&&
      audit.id===input.projection&&audit.source===input.source&&build.id===input.build&&build.source===audit.source&&
      capture.inspection===inspection.id&&capture.connection===connection.id,
      'Retain the same complete original captures, selected projection and native build.');
    equal(connection.config,original.connection.config,'The receiving connection changed its original broker selection.');
    requireValue(connection.operation===original.connection.operation&&connection.id===original.connection.connection,
      'The original connection operation changed.');
    const connectionRequest={connection:connection.id,expectedRevision:connection.revision-1,operation:connection.operation,config:connection.config};
    const inspectionRequest={connection:connection.id,revision:connection.revision,operation:inspection.operation};
    const captureRequest={inspection:inspection.id,operation:capture.operation,
      ranges:capture.ranges.map(({partition,start,end})=>({partition,start,end}))};
    const runRequest={capture:capture.id,expectedRevision:capture.revision};
    const projectRequest=audit.selection;
    requireValue(plain(projectRequest)&&projectRequest.operation===OPERATION+':audit','Use the original retained projection request.');
    const queryRequest={build:build.id,query:{limit:'50'}};
    const merchantRequest={build:build.id,...input.merchant};
    const compareRequest={before:build.id,after:currentBuild.id};
    const directDirectory=await privateDirectory(join(args.out,'direct'),{create:true});
    const cliDirectory=await privateDirectory(join(args.out,'cli'),{create:true});
    await privateDirectory(join(args.out,'remote'),{create:true});
    await privateDirectory(join(args.out,'responses'),{create:true});
    client=new KafkaWorkspaceClient({connectionFile:input.connectionFile,expectedBindingSha256:input.bindingSha256},{signal,timeoutMs:240000});
    const launch=await client.inspect();
    requireValue(launch.workspace===input.workspace&&launch.bindingSha256===input.bindingSha256&&launch.status==='KAFKA_WORKSPACE_READY',
      'The original authenticated customer console has another binding.');
    const binding={workspace:launch.workspace,workspaceId:launch.workspaceId,bindingSha256:launch.bindingSha256};
    const sourceFiles=[
      'stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/client-protocol.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/client.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/client-cli.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-tools.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-catalog.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-provider.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-setup.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-download.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-download-cli.mjs',
      'stellar-forge/mcp-merchant-operator/serve.mjs',
      'stellar-forge/mcp-merchant-operator/operator.mjs',
      'stellar-forge/mcp-merchant-operator/config.mjs',
      'stellar-forge/mcp-merchant-operator/provider-contract.mjs',
      'stellar-forge/mcp-merchant-operator/retained-download.mjs',
      'stellar-forge/mcp-merchant-operator/retained-file-reads.mjs',
      'stellar-forge/mcp-paid-agent/http-tools.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs'
    ];
    const selectedSource={};
    for(const path of sourceFiles){const bytes=await readBytes(join(args['product-root'],path),4*1024*1024,{privateFile:false});selectedSource[path]={bytes:bytes.length,sha256:sha(bytes),gitBlob:blob(bytes)};}
    const clientPins={'client-protocol.mjs':'ce83cd9ca6a59f7591fbe154ff791fb57ee5fe5e',
      'client.mjs':'78bcd5df1369cb37c75449a5deb7ed7ec8ef567d','client-cli.mjs':'ed0112608200d3b5dd4f42380933808b44ebcfe1'};
    for(const [name,pin] of Object.entries(clientPins))
      requireValue(selectedSource['stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/'+name].gitBlob===pin,
        'Compose the reviewed complete client source before receiving: '+name);
    const fileSelections=[
      {name:'kafka-project.zip',kind:'kafka-project',selection:{build:build.id,projection:audit.id}},
      {name:'ndjson-project.zip',kind:'ndjson-project',selection:{build:build.id}},
      {name:'dataset.zip',kind:'dataset',selection:{build:build.id}},
      {name:'changes.ndjson',kind:'changes',selection:{id:comparison.id}},
      {name:'merchant.zip',kind:'merchant',selection:merchantRequest},
      {name:'message.json',kind:'message',selection:{id:event.id}},
      {name:'state.json',kind:'state',selection:{}},
      {name:'projection.json',kind:'projection',selection:{id:audit.id}},
      ...[['connection',connection.id],['inspection',inspection.id],['capture',capture.id],['source',audit.source],['plan',mapping.id]]
        .map(([kind,id])=>({name:'record-'+kind+'.json',kind:'record',selection:{kind,id}})),
      {name:'query.json',kind:'query',selection:queryRequest}
    ];
    const receivingInput={schema:SCHEMA,operation:OPERATION,nativeSource:NATIVE_SOURCE,clientSource:CLIENT_SOURCE,
      originalReceivingSha256:sha(originalBytes),binding,productRoot:args['product-root'],source:selectedSource,
      original:{connection:connection.id,inspection:inspection.id,capture:capture.id,keyedCapture:receipts['keyed-capture'].id,
        projection:audit.id,source:audit.source,plan:mapping.id,build:build.id,currentBuild:currentBuild.id,message:event.id,comparison:comparison.id},
      requests:{connection:connectionRequest,inspection:inspectionRequest,capture:captureRequest,run:runRequest,project:projectRequest,
        query:queryRequest,compare:compareRequest,merchant:merchantRequest},
      files:fileSelections,workspaceAlias:ALIAS};
    await writeJson(join(args.out,'input.json'),receivingInput);
    const inputSha256=sha(encode(receivingInput));
    journal.inputSha256=inputSha256;journal.status='OPERATING';journal.updatedAt=stamp();await writeJson(journalPath,journal,true);

    // Complete client navigation and the same original idempotent customer operations.
    const topics=await client.configuredTopics();requireValue(topics.some(item=>item.connection===connection.id&&item.topic===connection.config.topic),'The original topic is absent.');
    await client.state();
    equal(await client.saveConnection(connectionRequest),connection,'Reopening the original connection changed it.');
    equal(await client.inspectConnection(inspectionRequest),inspection,'Reopening the original inspection changed its source.');
    equal(await client.prepareCapture(captureRequest),capture,'Reopening the original range selection changed its capture.');
    for(const value of [await client.runCapture(runRequest),await client.resumeCapture(runRequest),await client.cancelCapture(capture.id),
      await client.waitForCapture(capture.id,{signal,pollMs:100,timeoutMs:5000})])
      equal(value,capture,'The completed original capture changed during customer navigation.');
    let count=0,selectedFound=false;
    while(true) {
      const page=await client.messages(capture.id,{offset:count,limit:100});
      requireValue(page.total===capture.records&&page.messages.length>0,'The original message history ended before its captured source.');
      for(const item of page.messages) {
        requireValue(!['value','valueJson','valueBase64','headers'].some(key=>Object.hasOwn(item,key)),
          'The compact history unexpectedly expanded complete message values.');
        if(item.id===event.id){selectedFound=true;requireValue(item.sha256===event.sha256,'Selected message source digest changed.');}
      }
      count+=page.messages.length;if(count>=page.total)break;
    }
    requireValue(selectedFound&&count===capture.records,'The selected original message was not in its complete retained capture.');
    const full=await client.message(event.id);
    equal(full,event,'The original complete message changed through the Node client.');
    requireValue(full.valueJson===event.valueJson,'The original JSON numeric text changed through Node.');
    equal(await client.project(projectRequest),audit,'The original projection operation changed its retained edition.');
    requireValue((await client.savePlan(mapping.plan)).id===mapping.id,'The native mapping changed its identity.');
    equal(await client.build({source:audit.source,plan:mapping.id}),build,'The original native build changed.');
    equal(await client.query(queryRequest),query,'The original customer query changed through Node.');
    requireValue((await client.compare(compareRequest)).id===comparison.id,'The original comparison changed its identity.');
    await client.changes(comparison.id,{offset:0,limit:200});
    await client.connection(connection.id);await client.inspection(inspection.id);await client.capture(capture.id);
    await client.projection(audit.id);await client.source(audit.source);await client.plan(mapping.id);
    await checkpoint('client-native-operations',{binding,connection:connection.id,inspection:inspection.id,capture:capture.id,
      records:count,message:event.id,querySha256:sha(encode(query)),projection:audit.id,build:build.id,comparison:comparison.id});

    async function receiveDirect(spec) {
      const destination=join(directDirectory,spec.name);
      let result;
      try {
        const existing=await lstat(destination);
        requireValue(existing.isFile()&&!existing.isSymbolicLink(),'Preserve the complete original receiving file.');
        result=await inspectKafkaDownload(destination,{signal,...(journal.files[spec.name]?{sha256:journal.files[spec.name].sha256}:{})});
      } catch(error) {
        if(error.code!=='ENOENT')throw error;
        if(spec.kind==='kafka-project')result=await client.exportKafka(spec.selection,destination,{signal});
        else if(spec.kind==='ndjson-project')result=await client.exportNative(spec.selection.build,destination,{signal});
        else if(spec.kind==='dataset')result=await client.exportDataset(spec.selection.build,destination,{signal});
        else if(spec.kind==='changes')result=await client.exportChanges(spec.selection.id,destination,{signal});
        else if(spec.kind==='merchant')result=await client.exportMerchant(spec.selection,destination,{signal});
        else if(spec.kind==='message')result=await client.downloadMessage(spec.selection.id,destination,{signal});
        else if(spec.kind==='state')result=await client.downloadState(destination,{signal});
        else if(spec.kind==='projection')result=await client.downloadProjection(spec.selection.id,destination,{signal});
        else if(spec.kind==='record')result=await client.downloadRecord(spec.selection.kind,spec.selection.id,destination,{signal});
        else if(spec.kind==='query')result=await client.downloadQuery(spec.selection,destination,{signal});
      }
      const verified=await inspectKafkaDownload(destination,{signal,sha256:result.sha256});
      journal.files[spec.name]={kind:spec.kind,path:destination,bytes:verified.bytes,sha256:verified.sha256};
      await checkpoint('direct-files',{completed:Object.keys(journal.files).length});
      return verified;
    }
    for(const spec of fileSelections)await receiveDirect(spec);
    equal(await json(join(directDirectory,'message.json')),event,'The streamed complete message changed original bytes or values.');
    equal(await json(join(directDirectory,'query.json')),query,'The streamed complete query changed its native result.');
    const recoveryFile=join(directDirectory,'kafka-project.zip');
    let destinationKept=false;
    try{await client.exportKafka({build:build.id,projection:audit.id},recoveryFile,{signal});}
    catch(error){if(error.code!=='KAFKA_DESTINATION_EXISTS')throw error;destinationKept=true;}
    requireValue(destinationKept,'A fixed complete client export was unexpectedly replaced.');
    const recovered=await inspectKafkaDownload(recoveryFile,{signal,sha256:journal.files['kafka-project.zip'].sha256});
    const originalArchive=join(root,'delivery','audit-kafka-project.zip');
    const originalArchiveInfo=await inspectKafkaDownload(originalArchive,{signal});
    const nativeArchive=join(directDirectory,'ndjson-project.zip');
    const sourcePath=join(input.workspace,'sources',audit.source+'.ndjson');
    const sourceInfo=await inspectKafkaDownload(sourcePath,{signal,sha256:audit.source});
    requireValue((await client.importKafka(originalArchive,{signal,sha256:originalArchiveInfo.sha256})).build.id===build.id,'The original Kafka project did not reopen its build.');
    requireValue((await client.importNative(nativeArchive,{signal,sha256:journal.files['ndjson-project.zip'].sha256})).build.id===build.id,'The native project did not reconstruct its retained build.');
    requireValue((await client.addSource(sourcePath,{name:'source.ndjson',label:projectRequest.label},{signal,sha256:sourceInfo.sha256})).id===audit.source,
      'The original NDJSON source bytes changed on import.');
    await client.close();client=null;
    await checkpoint('client-files-and-drain',{files:journal.files,fixedExportRecovered:recovered.sha256,source:audit.source,originalArchive:originalArchiveInfo.sha256});

    // Actual CLI commands consume the same connection and create-only file contract.
    const queryRequestPath=join(cliDirectory,'query-request.json');await writeJson(queryRequestPath,queryRequest);
    const cliPath=join(kafka,'client-cli.mjs');
    const common=['--connection',input.connectionFile,'--expect-workspace',binding.workspaceId,'--expect-binding',binding.bindingSha256];
    const commandResults=[];
    commandResults.push(await runChild(cliPath,['inspect',...common],{signal}));
    for(const [name,commandArgs] of [
      ['record-inspection.json',['download-record',...common,'--kind','inspection','--id',inspection.id]],
      ['query.json',['download-query',...common,'--request',queryRequestPath]]
    ]) {
      const destination=join(cliDirectory,name);
      if(await optionalBytes(destination,32*1024*1024)===null)
        commandResults.push(await runChild(cliPath,[...commandArgs,'--out',destination],{signal}));
      commandResults.push(await runChild(cliPath,['inspect-file','--input',destination],{signal}));
    }
    equal(await json(join(cliDirectory,'record-inspection.json')),inspection,'The actual download-record CLI did not retain the original inspection.');
    equal(await json(join(cliDirectory,'query.json')),query,'The actual download-query CLI did not retain the complete native response.');
    await checkpoint('client-cli',{commands:commandResults.map(item=>({exitCode:item.exitCode,result:parseKafkaJson(item.stdout)}))});

    const hostConnection=join(args.out,'kafka-workspaces.json');
    await writeJson(hostConnection,{schema:'stellar-forge.kafka-merchant-connection.v1',workspaces:{
      [ALIAS]:{label:'Original native Kafka customer',connectionFile:input.connectionFile,
        expectedWorkspaceId:binding.workspaceId,expectedBindingSha256:binding.bindingSha256,
        inputs:{
          'original-kafka':{path:originalArchive,kind:'kafka-project',sha256:originalArchiveInfo.sha256},
          'original-native':{path:nativeArchive,kind:'ndjson-project',sha256:journal.files['ndjson-project.zip'].sha256},
          'original-source':{path:sourcePath,kind:'ndjson',sha256:sourceInfo.sha256}
        }}
    }});
    const setup=await initializeKafkaWorkspaceMerchant({directory:join(args.out,'merchant'),connection:hostConnection,name:'Original Kafka customer MCP'});
    requireValue(setup.state==='INITIALIZED'&&setup.ownership==='ORIGINAL_KAFKA_HTTP_WORKSPACE','The original merchant setup did not retain Kafka ownership.');
    await checkpoint('merchant-setup',setup);
    const environment={...process.env,MCP_ACCESS_TOKEN:randomBytes(32).toString('base64url')};
    const runtimePath=join(args.out,'mcp-runtime.json');
    const savedRuntime=await optionalJson(runtimePath);
    if(savedRuntime)requireValue(savedRuntime.schema===SCHEMA&&savedRuntime.inputSha256===inputSha256&&Number.isInteger(savedRuntime.port)&&savedRuntime.port>0&&savedRuntime.port<65536,
      'The original MCP listener belongs to another receiving operation.');
    let port=savedRuntime?.port??0;
    const declaredTools=catalogModule.kafkaWorkspaceTools(name=>name).sort();
    requireValue(declaredTools.length===26&&new Set(declaredTools).size===26,'Retain the complete original 26-tool Kafka catalog.');
    async function startMcp() {
      signal.throwIfAborted();
      mcp=await startMerchantMcp({configPath:setup.configuration,port,environment});
      const actualPort=Number(new URL(mcp.url).port);
      requireValue(actualPort>0&&(!port||actualPort===port),'The original MCP listener changed its receiving endpoint.');
      port=actualPort;
      await writeJson(runtimePath,{schema:SCHEMA,inputSha256,port});
      const actual=mcp.operator.tools.filter(tool=>tool.name.startsWith('merchant_kafka_')).map(tool=>tool.name).sort();
      equal(actual,declaredTools,'The original merchant factory did not discover the complete Kafka provider.');
      remote=await openMerchantFileClient({url:mcp.url,environment,signal,errorPrefix:'KAFKA',clientName:'starforge-kafka-customer-receiving'});
    }
    async function closeMcp() {
      if(!mcp)return;
      const current=mcp;await current.close();mcp=null;remote=null;
    }
    async function call(short,args={}) {
      signal.throwIfAborted();
      const name='merchant_kafka_'+short;
      const result=await remote.call(name,short==='workspaces'?args:{workspace:ALIAS,...args});
      journal.tools[name]=(journal.tools[name]??0)+1;return result;
    }
    async function nativeValue(result) {
      if(Object.hasOwn(result,'native'))return result.native;
      requireValue(result.response?.complete&&result.response.artifact,'The original MCP response has no complete native value.');
      const retained=result.response;
      const received=await downloadKafkaMerchantExport({url:mcp.url,environment,signal,workspace:ALIAS,artifact:retained.artifact,
        directory:join(args.out,'responses',retained.artifact),expectedWorkspaceId:binding.workspaceId,expectedBindingSha256:binding.bindingSha256});
      requireValue(received.state==='COMPLETE','The complete native MCP response was not received.');
      return json(join(received.directory,retained.file.name),128*1024*1024);
    }
    await startMcp();
    const initialWorkspace=await call('workspaces');
    requireValue(initialWorkspace.configured&&initialWorkspace.workspaces.some(item=>item.workspace===ALIAS),'The configured original Kafka workspace is absent from MCP.');
    const mcpInspect=await call('inspect');requireValue(mcpInspect.workspaceId===binding.workspaceId&&mcpInspect.bindingSha256===binding.bindingSha256,'The MCP provider selected another original workspace.');
    await nativeValue(await call('state'));
    const mcpTopics=await nativeValue(await call('configured_topics'));requireValue(mcpTopics.some(item=>item.connection===connection.id),'The original configured topic is absent from MCP.');
    for(const [kind,id] of [['connection',connection.id],['inspection',inspection.id],['capture',capture.id],['projection',audit.id],['source',audit.source],['plan',mapping.id]])
      await nativeValue(await call('read',{kind,id}));
    equal(await nativeValue(await call('save_connection',connectionRequest)),connection,'MCP changed the original saved connection.');
    equal(await nativeValue(await call('inspect_connection',inspectionRequest)),inspection,'MCP changed the original broker inspection.');
    equal(await nativeValue(await call('prepare_capture',captureRequest)),capture,'MCP changed the original explicit source ranges.');
    for(const [name,request] of [['run_capture',runRequest],['resume_capture',runRequest],['cancel_capture',{capture:capture.id}],
      ['wait_capture',{capture:capture.id,pollMs:100,timeoutMs:5000}]])
      equal(await nativeValue(await call(name,request)),capture,'MCP changed the original completed capture.');
    const mcpPage=await nativeValue(await call('messages',{capture:capture.id,offset:0,limit:100}));
    requireValue(mcpPage.total===capture.records,'MCP history changed its original captured record count.');
    equal(await nativeValue(await call('project',projectRequest)),audit,'MCP changed the original source edition.');
    requireValue((await nativeValue(await call('save_plan',{planJson:stringifyKafkaJson(mapping.plan)}))).id===mapping.id,'MCP changed the mapping identity.');
    equal(await nativeValue(await call('build',{source:audit.source,plan:mapping.id})),build,'MCP changed the native build.');
    equal(await nativeValue(await call('query',queryRequest)),query,'MCP changed exact native query values.');
    requireValue((await nativeValue(await call('compare',compareRequest))).id===comparison.id,'MCP changed the native comparison.');
    await nativeValue(await call('changes',{id:comparison.id,offset:0,limit:200}));
    for(const inputAlias of ['original-kafka','original-native','original-source']) {
      const received=await nativeValue(await call('import',{input:inputAlias}));
      requireValue(inputAlias==='original-source'?received.id===audit.source:received.build.id===build.id,
        'The host-declared original input did not recover its native source/build.');
    }
    const exports={};
    for(const spec of fileSelections) {
      const key=spec.name.replace(/\./g,'-'),operation=OPERATION+':client-mcp:'+key;
      const exported=await call('export',{operation,kind:spec.kind,selection:spec.selection});
      requireValue(exported.workspaceId===binding.workspaceId&&exported.bindingSha256===binding.bindingSha256&&
        HEX.test(exported.artifact)&&HEX.test(exported.file?.sha256),'The original MCP file export lost its binding.');
      const reopened=await call('export',{operation,kind:spec.kind,selection:spec.selection});
      requireValue(reopened.artifact===exported.artifact&&reopened.file.sha256===exported.file.sha256&&reopened.file.bytes===exported.file.bytes,
        'Reopening the same MCP export operation changed its completed file.');
      const manifest=await call('manifest',{artifact:exported.artifact});
      requireValue(manifest.file.sha256===exported.file.sha256&&manifest.artifact===exported.artifact,'The retained MCP completion manifest changed.');
      exports[spec.name]=exported;
    }
    const messageExport=await call('message',{id:event.id,operation:OPERATION+':client-mcp:complete-message'});
    requireValue(messageExport.file.sha256===journal.files['message.json'].sha256,'The complete MCP raw message bytes differ from the original HTTP bytes.');
    let exportedCount=0;
    while(true) {
      const page=await call('exports',{offset:exportedCount,limit:50});exportedCount+=page.items.length;
      if(page.nextOffset===null)break;
      requireValue(page.nextOffset===exportedCount&&page.items.length>0,'The original export history did not advance.');
    }
    requireValue(exportedCount>=fileSelections.length+1,'The original export history omitted completed customer files.');

    // Retained descriptors keep exact byte offsets, and release independently of exports.
    const archiveExport=exports['kafka-project.zip'];
    requireValue(archiveExport.file.bytes>1024,'The original complete project archive is unexpectedly empty.');
    const first=await call('file_read',{artifact:archiveExport.artifact,expectedSha256:archiveExport.file.sha256,offset:0,limit:256});
    const second=await call('file_read',{artifact:archiveExport.artifact,expectedSha256:archiveExport.file.sha256,readId:first.readId,offset:first.nextOffset,limit:256});
    for(const [chunk,expectedOffset] of [[first,0],[second,256]]) {
      const bytes=Buffer.from(chunk.data,'base64');
      requireValue(chunk.encoding==='base64'&&chunk.offset===expectedOffset&&chunk.bytesRead===256&&bytes.length===256&&
        bytes.toString('base64')===chunk.data&&chunk.file.sha256===archiveExport.file.sha256&&chunk.file.bytes===archiveExport.file.bytes,
        'The original MCP descriptor did not return the exact selected bytes.');
    }
    const originalPrefix=Buffer.concat([Buffer.from(first.data,'base64'),Buffer.from(second.data,'base64')]);
    const released=await call('file_release',{readId:second.readId});
    requireValue(released.state==='RELEASED','The original file read was not released.');
    await publish(join(args.out,'mcp-project-prefix.bin'),originalPrefix);
    await checkpoint('merchant-tools-and-exports',{tools:journal.tools,exports,message:messageExport,exportedCount,
      descriptor:{artifact:archiveExport.artifact,sha256:archiveExport.file.sha256,prefixSha256:sha(originalPrefix),bytes:originalPrefix.length,released:true}});

    // One real receiver pauses after its durable prefix, then reuses that prefix after factory reopen.
    const sdkOptions={url:mcp.url,environment,workspace:ALIAS,artifact:archiveExport.artifact,
      expectedWorkspaceId:binding.workspaceId,expectedBindingSha256:binding.bindingSha256};
    const inspected=await inspectKafkaMerchantExport({...sdkOptions,signal});
    requireValue(inspected.manifest.artifact===archiveExport.artifact&&inspected.manifest.file.sha256===archiveExport.file.sha256,
      'The original SDK selected another retained export.');
    const remoteDirectory=join(args.out,'remote','kafka-project');
    const partialController=new AbortController();
    const partialSignal=AbortSignal.any([signal,partialController.signal]);
    let partialProgress=null,priorComplete=null;
    try {
      priorComplete=await downloadKafkaMerchantExport({...sdkOptions,directory:remoteDirectory,signal:partialSignal,
        expectedManifestSha256:inspected.manifestSha256,chunkSize:512,
        onProgress:async progress=>{
          if(progress.bytes>0&&progress.bytes<progress.total){partialProgress=progress;partialController.abort();}
        }});
    } catch(error) {
      signal.throwIfAborted();
      if(!partialController.signal.aborted)throw error;
      requireValue(partialProgress?.bytes>0&&partialProgress.bytes<partialProgress.total,'The original receiver had no durable partial transfer.');
    }
    requireValue(partialProgress||priorComplete?.state==='COMPLETE','The original receiving operation neither retained progress nor completed.');
    await checkpoint('remote-durable-prefix',{artifact:archiveExport.artifact,manifestSha256:inspected.manifestSha256,
      progress:partialProgress,alreadyComplete:priorComplete});
    await closeMcp();
    await startMcp();
    const following=await inspectKafkaMerchantExport({...sdkOptions,url:mcp.url,signal});
    requireValue(following.manifestSha256===inspected.manifestSha256,'MCP restart changed the original completion manifest bytes.');
    const followingExport=await call('export',{operation:OPERATION+':client-mcp:kafka-project-zip',kind:'kafka-project',
      selection:{build:build.id,projection:audit.id}});
    requireValue(followingExport.artifact===archiveExport.artifact&&followingExport.file.sha256===archiveExport.file.sha256,
      'MCP restart regenerated the original fixed export.');
    const completed=await downloadKafkaMerchantExport({...sdkOptions,url:mcp.url,signal,directory:remoteDirectory,
      expectedManifestSha256:inspected.manifestSha256,chunkSize:4096});
    requireValue(completed.state==='COMPLETE'&&(!partialProgress||completed.resumedBytes>=partialProgress.bytes),
      'The original SDK did not resume its durable prefix.');
    const local=await inspectKafkaMerchantDownload({directory:remoteDirectory,workspace:ALIAS,artifact:archiveExport.artifact,
      expectedManifestSha256:inspected.manifestSha256,expectedWorkspaceId:binding.workspaceId,expectedBindingSha256:binding.bindingSha256,signal});
    const receivedArchive=join(remoteDirectory,archiveExport.file.name);
    const receivedInfo=await inspectKafkaDownload(receivedArchive,{signal,sha256:archiveExport.file.sha256});
    requireValue(receivedInfo.bytes===archiveExport.file.bytes&&(await prefix(receivedArchive,originalPrefix.length)).equals(originalPrefix),
      'The resumed customer project differs from the original retained file.');
    let replayProgress=0;
    const repeated=await downloadKafkaMerchantExport({...sdkOptions,url:mcp.url,signal,directory:remoteDirectory,
      expectedManifestSha256:inspected.manifestSha256,onProgress:()=>{replayProgress++;}});
    requireValue(repeated.state==='COMPLETE'&&replayProgress===0,'Reopening a complete received export unnecessarily transferred its files again.');
    const messageDirectory=join(args.out,'remote','message');
    const receivedMessage=await downloadKafkaMerchantExport({...sdkOptions,url:mcp.url,signal,artifact:messageExport.artifact,directory:messageDirectory});
    requireValue(receivedMessage.state==='COMPLETE','The full original MCP message was not received.');
    equal(await json(join(messageDirectory,messageExport.file.name)),event,'The full remote raw message changed exact source values.');
    const verifyCli=await runChild(join(kafka,'merchant-download-cli.mjs'),['verify','--directory',remoteDirectory,'--workspace',ALIAS,
      '--artifact',archiveExport.artifact,'--manifest-sha256',inspected.manifestSha256,'--workspace-id',binding.workspaceId,
      '--binding-sha256',binding.bindingSha256],{signal});
    await checkpoint('remote-receive-reopen',{manifestSha256:inspected.manifestSha256,completed,local,repeated,
      received:receivedInfo,completeMessage:receivedMessage,cli:{exitCode:verifyCli.exitCode,result:parseKafkaJson(verifyCli.stdout)}});
    const finalSummary=await call('workspaces');
    requireValue(finalSummary.activeFileReads===0,'A retained MCP file descriptor remains live after receiving.');
    equal(Object.keys(journal.tools).sort(),declaredTools,'The customer did not operate every original Kafka MCP tool.');
    await closeMcp();

    // Closing either consumer leaves the original customer's managed HTTP writer usable.
    client=new KafkaWorkspaceClient({connectionFile:input.connectionFile,expectedWorkspaceId:binding.workspaceId,
      expectedBindingSha256:binding.bindingSha256},{signal});
    const followingLaunch=await client.inspect();
    requireValue(followingLaunch.workspace===input.workspace&&followingLaunch.pid===launch.pid,
      'Consumer shutdown replaced the original managed Kafka owner.');
    equal(await client.query(queryRequest),query,'The original customer query changed after both consumer lifecycles.');
    equal(await client.capture(capture.id),capture,'The original captured source changed after receiving.');
    await client.close();client=null;
    final={schema:SCHEMA,operation:OPERATION,status:'COMPLETED',completedAt:stamp(),inputSha256,
      nativeSource:NATIVE_SOURCE,clientSource:CLIENT_SOURCE,binding,source:selectedSource,
      original:{capture:capture.id,records:capture.records,inspection:inspection.id,projection:audit.id,source:audit.source,
        plan:mapping.id,build:build.id,currentBuild:currentBuild.id,message:event.id,comparison:comparison.id},
      client:{files:journal.files,completeFileRecovery:true,cli:journal.steps['client-cli'].result,drained:true},
      merchant:{configuration:setup.configuration,workspaceAlias:ALIAS,tools:journal.tools,toolCount:declaredTools.length,
        exports,completeMessage:messageExport,listenerPort:port,factoryReopened:true,activeFileReads:finalSummary.activeFileReads,drained:true},
      receiving:journal.steps['remote-receive-reopen'].result,
      originalOwner:{pid:followingLaunch.pid,workspace:followingLaunch.workspace,querySha256:sha(encode(query))}};
    journal.status='CUSTOMER_OPERATED';journal.updatedAt=stamp();await writeJson(journalPath,journal,true);
  } catch(error) {
    primary=error;
    if(lease) {
      journal.status=signalExit?'INTERRUPTED':'FAILED';journal.updatedAt=stamp();
      journal.error={code:typeof error.code==='string'?error.code:error.name??'RECEIVING_FAILED',message:String(error.message??error)};
      try{lease.assertHeld();await writeJson(journalPath,journal,true);}catch{}
    }
  } finally {
    async function drainOwned(owner,name) {
      if(!owner)return;
      let attempts=0;
      while(true) {
        try {await owner.close();return;}
        catch(error) {
          primary??=error;attempts++;
          journal.status='CLOSING';journal.updatedAt=stamp();journal.closing??={};
          journal.closing[name]={attempts,code:typeof error.code==='string'?error.code:error.name??'CLOSE_FAILED',
            message:String(error.message??error),lastAttemptAt:journal.updatedAt};
          if(lease)try{lease.assertHeld();await writeJson(journalPath,journal,true);}catch{}
          if(attempts===1||attempts%30===0)process.stderr.write(JSON.stringify({
            schema:SCHEMA,operation:OPERATION,status:'CLOSING',owner:name,attempts})+'\n');
          // Keep this exact owner and output lease until its maintained retryable
          // close drains. Signals remain installed; neither cancellation nor a
          // failed descriptor close releases custody to another receiving process.
          await new Promise(done=>setTimeout(done,1000));
        }
      }
    }
    await drainOwned(client,'kafka-client');
    await drainOwned(mcp,'merchant-mcp');
    if(!primary&&signalExit)primary=new Error('The original receiving phase was interrupted during consumer drain.');
    if(!primary) {
      try {
        lease.assertHeld();
        final.completedAt=stamp();journal.status='COMPLETED';journal.updatedAt=final.completedAt;
        await writeJson(journalPath,journal,true);
        lease.assertHeld();
        await writeJson(join(args.out,'result.json'),final,true);
      } catch(error) {primary=error;}
    }
    if(primary&&lease) {
      journal.status=signalExit?'INTERRUPTED':'FAILED';journal.updatedAt=stamp();
      journal.error={code:typeof primary.code==='string'?primary.code:primary.name??'RECEIVING_FAILED',message:String(primary.message??primary)};
      try{lease.assertHeld();await writeJson(journalPath,journal,true);}catch{}
    }
    if(lease)try{await lease.close();}catch(error){primary??=error;}
    if(!primary&&signalExit)primary=new Error('The original receiving phase was interrupted during final ownership release.');
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
  }
  if(primary) {
    process.stderr.write(JSON.stringify({schema:SCHEMA,operation:OPERATION,status:signalExit?'INTERRUPTED':'FAILED',
      code:typeof primary.code==='string'?primary.code:primary.name??'RECEIVING_FAILED',message:String(primary.message??primary)})+'\n');
    return {exitCode:signalExit||1,result:null};
  }
  process.stdout.write(JSON.stringify({schema:SCHEMA,operation:OPERATION,status:final.status,toolCount:final.merchant.toolCount,
    capture:final.original.capture,build:final.original.build,result:join(args.out,'result.json')})+'\n');
  return {exitCode:0,result:final};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=(await receiveKafkaClientAndMcp()).exitCode;
