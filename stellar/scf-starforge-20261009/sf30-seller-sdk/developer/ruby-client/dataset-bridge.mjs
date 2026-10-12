// MIT. Complete Ruby dataset receiving over the original SF88 Dataset and SF100 delivery.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir,link,unlink} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const SCHEMA='stellar-forge.ruby-buyer-call.v1',LIMIT=64*1024*1024;
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9._:-]{1,128}$/;
const abort=new AbortController(),stop=()=>abort.abort();
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const need=(x,code)=>{if(!x)throw Object.assign(new Error(code),{code});};
const sha=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const identity=x=>sha(JSON.stringify(canonical(x)));
const json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const decode=x=>new TextDecoder('utf-8',{fatal:true}).decode(x);
const safeCode=e=>/^[A-Z][A-Z0-9_]{0,119}$/.test(e?.code??'')?e.code:'RUBY_NATIVE_OPERATION_FAILED';
async function directory(path,{create=false}={}){
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'RUBY_ABSOLUTE_DIRECTORY_REQUIRED');
  if(create){try{await mkdir(path,{mode:0o700});await sync(dirname(path));}catch(e){if(e.code!=='EEXIST')throw e;}}
  const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||!(s.mode&0o077)&&s.uid===process.getuid()),'RUBY_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
async function read(path,max=LIMIT){
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=await f.stat({bigint:true});
    need(s.isFile()&&s.size<=BigInt(max),'RUBY_RETAINED_FILE_REQUIRED');
    const data=await f.readFile(),a=await f.stat({bigint:true});
    need(BigInt(data.length)===s.size&&s.dev===a.dev&&s.ino===a.ino&&s.size===a.size&&
      s.mtimeNs===a.mtimeNs&&s.ctimeNs===a.ctimeNs,'RUBY_RETAINED_FILE_CHANGED');
    return data;
  }finally{await f.close();}
}
async function optional(path,max){try{return await read(path,max);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function sync(path){
  if(process.platform==='win32')return;
  const f=await open(path,'r');try{await f.sync();}finally{await f.close();}
}
async function once(path,bytes){
  const temp=join(dirname(path),'.ruby-'+randomUUID());let f;
  try{
    f=await open(temp,'wx',0o600);await f.writeFile(bytes);await f.sync();await f.close();f=null;
    try{await link(temp,path);await sync(dirname(path));}
    catch(e){if(e.code!=='EEXIST')throw e;need((await read(path,Math.max(LIMIT,bytes.length))).equals(bytes),'RUBY_SAVED_OUTPUT_CONFLICT');}
  }finally{await f?.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}

const FILES=['dataset.jsonl','dataset.csv','review.html','manifest.json','semantics.json'];
const MAX_FILE=256*1024*1024;
async function nativeSeed(buyer,id,sourceSha256){
  const operation=buyer.operation(id);
  const sourceBytes=await read(join(operation.directory,'ruby-seller-source.json'),65536);
  const source=JSON.parse(decode(sourceBytes));
  need(source.schema==='stellar-forge.ruby-seller-operation.v1'&&source.request?.intentId===id&&
    source.sourceSha256===sourceSha256&&HASH.test(sourceSha256??''),'RUBY_DATASET_SOURCE_CHANGED');
  const configBytes=await read(operation.configPath,65536),cfg=JSON.parse(decode(configBytes));
  const metadata=JSON.parse(decode(await read(join(operation.directory,'operation.json'),65536)));
  need(sha(configBytes)===source.configSha256&&metadata.configSha256===source.configSha256&&
    metadata.bodySha256===source.nativeBodySha256&&
    (metadata.ticketSha256??null)===(source.ticketSha256??null)&&
    (metadata.nativeWorkspace??null)===(source.nativeWorkspace??null)&&
    identity(cfg.operation)===identity(source.request),'RUBY_DATASET_SEED_CHANGED');
  need(cfg.operation.method==='GET'&&cfg.operation.bodyFile===undefined&&source.body===null&&
    source.nativeBodySha256===sha(Buffer.alloc(0)),'RUBY_DATASET_GET_SOURCE_REQUIRED');
  need(await optional(join(operation.directory,'attempt.json'),65536)===null,
    'RUBY_DATASET_USE_ORIGINAL_ACQUIRED_SESSION');
  // Resolve every original relative signer/operator path against the ORIGINAL
  // operation config before copying it into a dataset entry.
  const originalConfig=await import(pathToFileURL(join(buyer.runtime.directory,'config.mjs')).href);
  const normalized=await originalConfig.config(operation.configPath);
  return {operation,source,sourceBytes,cfg:normalized};
}
function limitsOf(input){
  need(plain(input)&&Object.keys(input).sort().join(',')==='maxPageBytes,maxPages,maxRows,maxTotalAtomic',
    'RUBY_DATASET_LIMITS_REQUIRED');
  need(Number.isSafeInteger(input.maxPages)&&input.maxPages>=1&&input.maxPages<=10000&&
    Number.isSafeInteger(input.maxRows)&&input.maxRows>=1&&input.maxRows<=1000000&&
    Number.isSafeInteger(input.maxPageBytes)&&input.maxPageBytes>=1024&&input.maxPageBytes<=16777216&&
    typeof input.maxTotalAtomic==='string'&&/^[1-9][0-9]{0,38}$/.test(input.maxTotalAtomic)&&
    BigInt(input.maxTotalAtomic)<=170141183460469231731687303715884105727n,'RUBY_DATASET_LIMITS_INVALID');
  return input;
}
async function bindSelection(buyer,args,id,runtime,api,page){
  const selected=await nativeSeed(buyer,id,args.sourceSha256);
  const limits=limitsOf(args.limits);
  if(args.originalSession===null){
    const exporter=await import(pathToFileURL(join(runtime,'..','sf100-buyer-dataset-delivery','deliver.mjs')).href);
    need(Number.isSafeInteger(exporter.MAX_DATASET_PAGES)&&Number.isSafeInteger(exporter.MAX_DATASET_PAGE_BYTES),
      'RUBY_DATASET_ORIGINAL_EXPORTER_REQUIRED');
    need(limits.maxPages<=exporter.MAX_DATASET_PAGES&&limits.maxPageBytes<=exporter.MAX_DATASET_PAGE_BYTES,
      'RUBY_DATASET_DELIVERY_LIMITS_EXCEEDED');
  }
  need(args.expectedSnapshot===null||HASH.test(args.expectedSnapshot??''),'RUBY_DATASET_SNAPSHOT_REQUIRED');
  const root=await directory(join(buyer.stateDirectory,'ruby-datasets'),{create:true});
  const scope=await directory(join(root,sha(id)),{create:true});
  let nativeConfig=structuredClone(selected.cfg),nativeSessionId=id,originalSession=null;
  // SF88 Dataset owns its own response directory. Preserve all other original
  // request/operator configuration and keep the source digest in the selection.
  delete nativeConfig.responseFile;
  let workspace=selected.source.nativeWorkspace??null;
  const selectedSnapshot=args.expectedSnapshot??page.validateDatasetQuery(nativeConfig.operation.url,{initial:true}).get('snapshot')??null;
  if(args.originalSession!==null){
    const value=args.originalSession;
    need(plain(value)&&Object.keys(value).sort().join(',')==='directory,sha256'&&HASH.test(value.sha256??''),
      'RUBY_DATASET_ORIGINAL_SESSION_REQUIRED');
    const dir=await directory(value.directory);
    const raw=await read(join(dir,'session.json'),262144);
    need(sha(raw)===value.sha256,'RUBY_DATASET_ORIGINAL_DEFINITION_CHANGED');
    const definition=api.validateDatasetDefinition(JSON.parse(decode(raw)),dir);
    const withoutIntent=value=>{const {intentId,...rest}=value;return rest;};
    need(identity(withoutIntent(definition.config.operation))===identity(withoutIntent(nativeConfig.operation))&&
      identity(definition.limits)===identity(limits)&&
      definition.expectedSnapshot===selectedSnapshot,'RUBY_DATASET_ORIGINAL_SELECTION_CHANGED');
    if(definition.workspaceDirectory!==undefined){
      need(workspace===null||workspace===definition.workspaceDirectory,'RUBY_DATASET_WORKSPACE_CHANGED');
      workspace=definition.workspaceDirectory;
    }
    nativeConfig=definition.config;nativeSessionId=definition.config.operation.intentId;
    originalSession={directory:dir,sha256:sha(raw)};
  }
  const parameters=page.validateDatasetQuery(nativeConfig.operation.url,{initial:true});
  const expected=args.expectedSnapshot??parameters.get('snapshot')??null;
  need(!parameters.has('snapshot')||expected===parameters.get('snapshot'),'RUBY_DATASET_SNAPSHOT_CHANGED');
  const value={schema:'stellar-forge.ruby-dataset-selection.v1',datasetId:id,seedIntentId:id,
    sourceSha256:selected.source.sourceSha256,sourceRecordSha256:sha(selected.sourceBytes),
    requestSha256:identity(selected.source.request),
    originalManifestSha256:selected.source.originalManifestSha256,
    rubyManifestSha256:selected.source.rubyManifestSha256,
    seedConfigurationSha256:selected.source.configSha256,
    configurationSha256:page.digest(page.canonical(nativeConfig)),
    nativeSessionId,workspaceDirectory:workspace,originalSession,limits,expectedSnapshot:expected,
    configurationTransform:originalSession===null?'REMOVE_SINGLE_RESPONSE_OUTPUT':'ATTACH_ORIGINAL_DEFINITION'};
  await once(join(scope,'source.json'),selected.sourceBytes);
  await once(join(scope,'selection.json'),json(value));
  const dataset=buyer.dataset(id),metadataPath=join(dataset.directory,'dataset.json');
  const prior=await optional(metadataPath,262144);
  if(prior===null){
    if(originalSession!==null)await buyer.attachDataset({id,directory:originalSession.directory});
    else await buyer.createDataset({id,config:nativeConfig,...limits,expectedSnapshot:expected});
  }else{
    const metadata=JSON.parse(decode(prior));
    need(metadata.schema==='stellar-forge.node-dataset.v1'&&metadata.id===id&&
      metadata.entryDirectory===dataset.directory&&
      (originalSession!==null?metadata.source?.kind==='attached'&&metadata.sessionDirectory===originalSession.directory:
        metadata.source?.kind==='config'&&metadata.sessionDirectory===join(dataset.directory,'session')&&
        identity(metadata.limits)===identity(limits)&&metadata.expectedSnapshot===expected),'RUBY_DATASET_ENTRY_CHANGED');
    if(originalSession===null){
      const native=await(await import(pathToFileURL(join(runtime,'config.mjs')).href)).config(join(dataset.directory,'config.json'));
      need(page.digest(page.canonical(native))===value.configurationSha256,'RUBY_DATASET_CONFIGURATION_CHANGED');
    }
    await dataset.initialize({signal:abort.signal});
  }
  return selection(buyer,id,args.sourceSha256,api,page);
}
async function selection(buyer,id,sourceSha256,api,page){
  const scope=await directory(join(buyer.stateDirectory,'ruby-datasets',sha(id)));
  const raw=await read(join(scope,'selection.json'),262144),value=JSON.parse(decode(raw));
  const sourceRaw=await read(join(scope,'source.json'),65536),source=JSON.parse(decode(sourceRaw));
  need(value.schema==='stellar-forge.ruby-dataset-selection.v1'&&value.datasetId===id&&value.seedIntentId===id&&
    value.sourceSha256===sourceSha256&&sha(sourceRaw)===value.sourceRecordSha256&&
    source.sourceSha256===sourceSha256&&source.request?.intentId===id&&
    identity(source.request)===value.requestSha256,'RUBY_DATASET_SELECTION_CHANGED');
  const dataset=buyer.dataset(id),metadata=JSON.parse(decode(await read(join(dataset.directory,'dataset.json'),262144)));
  need(metadata.schema==='stellar-forge.node-dataset.v1'&&metadata.id===id&&
    metadata.entryDirectory===dataset.directory,'RUBY_DATASET_ENTRY_CHANGED');
  const session=await directory(metadata.sessionDirectory);
  need(session===(value.originalSession?.directory??join(dataset.directory,'session'))&&
    metadata.source?.kind===(value.originalSession===null?'config':'attached'),'RUBY_DATASET_ENTRY_CHANGED');
  const definitionRaw=await read(join(session,'session.json'),262144);
  if(value.originalSession!==null)need(sha(definitionRaw)===value.originalSession.sha256,'RUBY_DATASET_ORIGINAL_DEFINITION_CHANGED');
  const definition=api.validateDatasetDefinition(JSON.parse(decode(definitionRaw)),session);
  need(definition.configurationSha256===value.configurationSha256&&
    definition.config.operation.intentId===value.nativeSessionId&&
    identity(definition.limits)===identity(value.limits)&&definition.expectedSnapshot===value.expectedSnapshot,
    'RUBY_DATASET_CONFIGURATION_CHANGED');
  need(definition.workspaceDirectory===undefined||definition.workspaceDirectory===value.workspaceDirectory,
    'RUBY_DATASET_WORKSPACE_CHANGED');
  return {scope,raw,value,sourceRaw,source,dataset,session,definition,definitionRaw};
}
function checkedReport(binding,report){
  need(report?.schema==='stellar-forge.sf88.dataset-acquisition.v1'&&report.directory===binding.session,
    'RUBY_DATASET_NATIVE_REPORT_REQUIRED');
  if(report.status!=='RUNNING')need(report.configurationSha256===binding.value.configurationSha256&&
    report.sessionId===binding.value.nativeSessionId&&report.expectedSnapshot===binding.value.expectedSnapshot&&
    identity(report.limits)===identity(binding.value.limits),'RUBY_DATASET_NATIVE_REPORT_CHANGED');
  return report;
}
function reviewOf(binding,report){
  const value={schema:'stellar-forge.ruby-dataset-review.v1',datasetId:binding.value.datasetId,
    selectionSha256:sha(binding.raw),definitionSha256:sha(binding.definitionRaw),native:checkedReport(binding,report)};
  return {...value,reviewSha256:identity(value)};
}
async function currentReview(binding){
  const result=await binding.dataset.inspect({signal:abort.signal});
  need(result.process.exitCode===0&&!result.process.errorCode,'RUBY_DATASET_STATUS_UNAVAILABLE');
  return reviewOf(binding,result.native);
}
async function verifySaved(path,expected){
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await f.stat({bigint:true});
    need(before.isFile()&&before.size===BigInt(expected.bytes),'RUBY_DATASET_FILE_CHANGED');
    const hash=createHash('sha256');let count=0;
    for await(const part of f.createReadStream({autoClose:false,start:0})){count+=part.length;hash.update(part);}
    const after=await f.stat({bigint:true});
    need(count===expected.bytes&&hash.digest('hex')===expected.sha256&&before.size===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'RUBY_DATASET_FILE_CHANGED');
  }finally{await f.close();}
}
async function receive(binding,output){
  output=await directory(output,{create:true});
  need(output!==binding.scope&&output!==binding.session&&output!==binding.dataset.directory&&
    !binding.scope.startsWith(output+'/')&&!binding.session.startsWith(output+'/')&&
    !binding.dataset.directory.startsWith(output+'/'),'RUBY_DATASET_RECEIVING_DIRECTORY_REQUIRED');
  const manifestPath=join(output,'dataset-customer.json'),complete=await optional(manifestPath,262144);
  async function reopen(raw){
    const manifest=JSON.parse(decode(raw));
    need(manifest.schema==='stellar-forge.ruby-dataset-delivery.v1'&&
      manifest.datasetId===binding.value.datasetId&&manifest.intentId===binding.value.nativeSessionId&&
      manifest.sourceSha256===binding.value.sourceSha256&&manifest.selectionSha256===sha(binding.raw)&&
      manifest.configurationSha256===binding.value.configurationSha256&&Array.isArray(manifest.files),
      'RUBY_DATASET_CUSTOMER_SELECTION_CHANGED');
    for(const file of manifest.files){
      need(['source.json','selection.json','acquisition.json','native-delivery.json',...FILES].includes(file.name)&&
        HASH.test(file.sha256??'')&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE,
        'RUBY_DATASET_FILE_DESCRIPTOR_INVALID');
      await verifySaved(join(output,file.name),file);
    }
    return {directory:output,manifestSha256:sha(raw),manifest};
  }
  if(complete!==null)return reopen(complete);
  const recovery=await binding.dataset.recover({signal:abort.signal});
  need(recovery.process.exitCode===0&&!recovery.process.errorCode,'RUBY_DATASET_RECOVERY_UNAVAILABLE');
  const acquisition=checkedReport(binding,recovery.native);
  need(acquisition.status==='COMPLETE','RUBY_DATASET_COMPLETE_SESSION_REQUIRED');
  const native=await binding.dataset.deliver(join(binding.dataset.directory,'ruby-delivery'),{signal:abort.signal});
  need(native.report.sourceDirectory===binding.session&&HASH.test(native.report.sourceBindingSha256??''),
    'RUBY_DATASET_DELIVERY_SOURCE_CHANGED');
  const proposed={'source.json':binding.sourceRaw,'selection.json':binding.raw,
    'acquisition.json':json(acquisition),'native-delivery.json':json(native.report)},sourceFiles={};
  for(const [name,bytes]of Object.entries(proposed)){
    const path=join(output,name),retained=await optional(path,LIMIT);
    if(retained===null){await once(path,bytes);sourceFiles[name]=bytes;continue;}
    if(name==='source.json'||name==='selection.json')need(retained.equals(bytes),'RUBY_DATASET_RECEIVING_SOURCE_CHANGED');
    else if(name==='acquisition.json'){
      const saved=checkedReport(binding,JSON.parse(decode(retained)));
      need(saved.status==='COMPLETE'&&saved.snapshot===acquisition.snapshot&&saved.totalRows===acquisition.totalRows&&
        identity(saved.pages)===identity(acquisition.pages),'RUBY_DATASET_ORIGINAL_REPORT_CHANGED');
    }else{
      const saved=JSON.parse(decode(retained));
      need(saved.schema===native.report.schema&&saved.directory===native.report.directory&&
        saved.sourceDirectory===native.report.sourceDirectory&&saved.sourceBindingSha256===native.report.sourceBindingSha256&&
        identity(saved.outputs)===identity(native.report.outputs)&&identity(saved.nativeStatus)===identity(native.report.nativeStatus),
        'RUBY_DATASET_ORIGINAL_REPORT_CHANGED');
    }
    sourceFiles[name]=retained;
  }
  // Each complete original report is durable before its descriptor joins the
  // output plan. Restart can recover an interrupted prefix without reconstructing
  // a lost report from changed timestamps or native "resumed" labels.
  const plan={schema:'stellar-forge.ruby-dataset-output-plan.v1',datasetId:binding.value.datasetId,
    selectionSha256:sha(binding.raw),sourceFiles:Object.fromEntries(Object.entries(sourceFiles)
      .map(([name,bytes])=>[name,{bytes:bytes.length,sha256:sha(bytes)}])),
    nativeFiles:Object.fromEntries(Object.entries(native.report.outputs).map(([name,meta])=>[name,{bytes:meta.bytes,sha256:meta.sha256}]))};
  const planPath=join(output,'receiving-plan.json');
  await once(planPath,json(plan));
  for(const name of FILES){
    const descriptor=native.report.outputs[name];if(descriptor===undefined)continue;
    need(descriptor.path===join(native.report.directory,name)&&Number.isSafeInteger(descriptor.bytes)&&
      descriptor.bytes>=0&&descriptor.bytes<=MAX_FILE&&HASH.test(descriptor.sha256??''),'RUBY_DATASET_NATIVE_FILE_INVALID');
    try{await native.file(name).saveAs(join(output,name),{signal:abort.signal});}
    catch(error){if(error.code!=='EEXIST')throw error;await verifySaved(join(output,name),descriptor);}
  }
  const retainedPlan=JSON.parse(decode(await read(planPath,262144)));
  const files=Object.entries({...retainedPlan.sourceFiles,...retainedPlan.nativeFiles})
    .map(([name,value])=>({name,...value}));
  const manifest={schema:'stellar-forge.ruby-dataset-delivery.v1',datasetId:binding.value.datasetId,
    intentId:binding.value.nativeSessionId,seedIntentId:binding.value.seedIntentId,
    sourceSha256:binding.value.sourceSha256,selectionSha256:sha(binding.raw),
    configurationSha256:binding.value.configurationSha256,sourceBindingSha256:native.report.sourceBindingSha256,
    nativeManifestSha256:native.report.outputs['manifest.json'].sha256,
    snapshot:native.manifest.dataset.snapshot,rowCount:native.manifest.dataset.rows,
    fields:native.manifest.dataset.projectedFields,files};
  const raw=json(manifest);await once(manifestPath,raw);return reopen(raw);
}
let call,responsePath;
try{
  need(process.argv.length===3,'RUBY_CALL_FILE_REQUIRED');
  const path=resolve(process.argv[2]);await directory(dirname(path));
  const stat=await lstat(path);
  need(stat.isFile()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&stat.size<=LIMIT,'RUBY_PRIVATE_CALL_REQUIRED');
  call=JSON.parse(decode(await read(path)));responsePath=join(dirname(path),'response.json');
  need(call.schema===SCHEMA&&/^[a-f0-9-]{36}$/.test(call.callId??'')&&ID.test(call.id??'')&&
    plain(call.runtime)&&plain(call.arguments)&&
    ['dataset.prepare','dataset.review','dataset.status','dataset.run','dataset.recover','dataset.receive'].includes(call.action),
    'RUBY_DATASET_CALL_INVALID');
  need(await optional(responsePath)===null,'RUBY_CALL_ALREADY_RECORDED');
  const cfg=call.runtime;
  need(Object.keys(cfg).every(key=>['runtimeDirectory','stateDirectory','operatorProfile','workspaceDirectory','timeoutMs','outputLimit'].includes(key)),
    'RUBY_NATIVE_RUNTIME_FIELDS_INVALID');
  const runtime=resolve(cfg.runtimeDirectory),entry=join(runtime,'node','index.mjs');
  need(isAbsolute(cfg.runtimeDirectory)&&isAbsolute(cfg.stateDirectory)&&(await lstat(entry)).isFile(),
    'RUBY_ORIGINAL_NODE_BUYER_REQUIRED');
  const [{Buyer},api,page]=await Promise.all([import(pathToFileURL(entry).href),
    import(pathToFileURL(join(runtime,'dataset-session.mjs')).href),
    import(pathToFileURL(join(runtime,'dataset-page.mjs')).href)]);
  // The selected original operation already owns its frozen operator profile.
  const {operatorProfile,workspaceDirectory,...runtimeOptions}=cfg;
  const buyer=new Buyer({...runtimeOptions,node:process.execPath,environment:process.env});
  await buyer.ready();
  const args=call.arguments;
  const binding=call.action==='dataset.prepare'
    ?await bindSelection(buyer,args,call.id,runtime,api,page)
    :await selection(buyer,call.id,args.sourceSha256,api,page);
  let result;
  if(call.action==='dataset.prepare')result={datasetId:call.id,selection:binding.value,
    selectionSha256:sha(binding.raw),directory:binding.dataset.directory,session:binding.session};
  else if(call.action==='dataset.review'||call.action==='dataset.status')result=await currentReview(binding);
  else if(call.action==='dataset.recover'){
    const recovered=await binding.dataset.recover({signal:abort.signal});
    need(recovered.process.exitCode===0&&!recovered.process.errorCode,'RUBY_DATASET_RECOVERY_UNAVAILABLE');
    result=reviewOf(binding,recovered.native);
  }else if(call.action==='dataset.run'){
    const current=await currentReview(binding);
    need(plain(args.review)&&identity(args.review)===identity(current),'RUBY_DATASET_REVIEW_CHANGED');
    need(current.native.status==='READY'||current.native.status==='COMPLETE','RUBY_DATASET_NOT_READY');
    result=current.native.status==='COMPLETE'?current:reviewOf(binding,
      await api.runDatasetSession(binding.session,{signal:abort.signal,environment:process.env,
        emitPageSummaries:false,...(binding.value.workspaceDirectory===null?{}:{workspace:binding.value.workspaceDirectory})}));
  }else result=await receive(binding,args.directory);
  const response=json({schema:SCHEMA,callId:call.callId,action:call.action,id:call.id,ok:true,result});
  need(response.length<=LIMIT,'RUBY_DATASET_REPORT_LIMIT_EXCEEDED');
  await once(responsePath,response);
}catch(error){
  if(responsePath&&call)try{await once(responsePath,json({schema:SCHEMA,callId:call.callId,
    action:call.action,id:call.id,ok:false,error:{code:safeCode(error)}}));}catch{process.exitCode=2;}
  process.exitCode??=1;
}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
