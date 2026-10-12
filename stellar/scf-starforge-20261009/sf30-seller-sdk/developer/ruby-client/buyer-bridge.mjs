// MIT. Ruby applications use the original Node Buyer and saved response APIs.
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
function bodyOf(bound){
  if(bound.body===null){need(bound.bodyBase64===undefined,'RUBY_REQUEST_BODY_CHANGED');return undefined;}
  need(plain(bound.body)&&Number.isSafeInteger(bound.body.bytes)&&bound.body.bytes>=0&&
    bound.body.bytes<=16*1024*1024&&HASH.test(bound.body.sha256)&&typeof bound.bodyBase64==='string','RUBY_REQUEST_BODY_CHANGED');
  const bytes=Buffer.from(bound.bodyBase64,'base64');
  need(bytes.toString('base64')===bound.bodyBase64&&bytes.length===bound.body.bytes&&sha(bytes)===bound.body.sha256,'RUBY_REQUEST_BODY_CHANGED');
  return bytes;
}
function boundSource(value){
  need(plain(value)&&value.schema==='stellar-forge.ruby-seller-request.v1'&&HASH.test(value.sourceSha256??'')&&
    typeof value.operationId==='string'&&plain(value.request)&&ID.test(value.request.intentId??'')&&
    HASH.test(value.inputSha256??'')&&HASH.test(value.originalManifestSha256??'')&&HASH.test(value.rubyManifestSha256??''),
    'RUBY_ORIGINAL_REQUEST_REQUIRED');
  const body=bodyOf(value),{bodyBase64,...record}=value;
  return {record,body};
}
function summary(result){
  return result===null?null:{record:result.record,native:result.native,status:result.status,
    delivery:result.delivery,stream:result.stream,ok:result.ok};
}
async function verifyBinding(operation,source){
  const review=await operation.review({signal:abort.signal});
  const config=JSON.parse(decode(await read(operation.configPath,65536)));
  const {bodyFile,...request}=config.operation;
  need(identity(request)===identity(source.record.request),'RUBY_ORIGINAL_OPERATION_CHANGED');
  need(review.bodySha256===sha(source.body??Buffer.alloc(0)),'RUBY_ORIGINAL_BODY_CHANGED');
  if(source.body===undefined)need(bodyFile===undefined,'RUBY_ORIGINAL_BODY_CHANGED');
  const expected={...source.record,schema:'stellar-forge.ruby-seller-operation.v1',
    configSha256:review.configSha256,nativeBodySha256:review.bodySha256,
    ticketSha256:review.ticketSha256??null,nativeWorkspace:review.nativeWorkspace??null};
  const path=join(operation.directory,'ruby-seller-source.json'),prior=await optional(path);
  if(prior)need(identity(JSON.parse(decode(prior)))===identity(expected),'RUBY_ORIGINAL_SOURCE_CHANGED');
  else{
    need(await optional(join(operation.directory,'attempt.json'),65536)===null,'RUBY_SOURCE_BINDING_REQUIRED');
    await once(path,json(expected));
  }
  return {review,source:expected};
}
async function existingSource(operation){
  const source=JSON.parse(decode(await read(join(operation.directory,'ruby-seller-source.json'))));
  need(source.schema==='stellar-forge.ruby-seller-operation.v1'&&source.request?.intentId===operation.intentId&&
    HASH.test(source.sourceSha256??''),'RUBY_ORIGINAL_SOURCE_REQUIRED');
  const info=await operation.inspect();
  const config=JSON.parse(decode(await read(operation.configPath,65536))),{bodyFile,...request}=config.operation;
  need(identity(request)===identity(source.request),'RUBY_ORIGINAL_OPERATION_CHANGED');
  const meta=JSON.parse(decode(await read(join(operation.directory,'operation.json'),65536)));
  need(meta.configSha256===source.configSha256&&meta.bodySha256===source.nativeBodySha256&&
    (meta.ticketSha256??null)===(source.ticketSha256??null)&&
    (meta.nativeWorkspace??null)===(source.nativeWorkspace??null),'RUBY_ORIGINAL_SOURCE_CHANGED');
  return {source,info,config,bodyFile};
}
async function verifySaved(path,expected){
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await f.stat({bigint:true});
    need(before.isFile()&&before.size===BigInt(expected.bytes),'RUBY_CUSTOMER_FILE_CHANGED');
    const digest=createHash('sha256');let n=0;
    for await(const part of f.createReadStream({autoClose:false,start:0})){n+=part.length;digest.update(part);}
    const after=await f.stat({bigint:true});
    need(n===expected.bytes&&digest.digest('hex')===expected.sha256&&before.size===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'RUBY_CUSTOMER_FILE_CHANGED');
  }finally{await f.close();}
}
async function receive(operation,output){
  const selected=await existingSource(operation),result=await operation.recover();
  need(result!==null&&result.delivery.status==='SAVED','RUBY_ORIGINAL_RESPONSE_REQUIRED');
  const verified=await result.verify({signal:abort.signal});
  output=await directory(output,{create:true});
  need(output!==operation.directory&&output!==dirname(operation.directory),'RUBY_RECEIVING_DIRECTORY_REQUIRED');
  const manifestPath=join(output,'customer-delivery.json'),complete=await optional(manifestPath,131072);
  async function verifyCompletion(bytes){
    const m=JSON.parse(decode(bytes));
    need(m.schema==='stellar-forge.ruby-customer-delivery.v1'&&m.intentId===operation.intentId&&
      m.sourceSha256===selected.source.sourceSha256&&m.configSha256===selected.source.configSha256&&
      m.responseSha256===verified.sha256&&Array.isArray(m.files),'RUBY_CUSTOMER_SELECTION_CHANGED');
    for(const f of m.files){
      need(['source.json','request.json','request.body','review.json','result.json','response.bin'].includes(f.name)&&
        Number.isSafeInteger(f.bytes)&&f.bytes>=0&&HASH.test(f.sha256??''),'RUBY_CUSTOMER_MANIFEST_INVALID');
      await verifySaved(join(output,f.name),f);
    }
    need(new Set(m.files.map(f=>f.name)).size===m.files.length&&
      ['source.json','request.json','review.json','result.json','response.bin',...(selected.bodyFile?['request.body']:[])].every(n=>m.files.some(f=>f.name===n))&&
      m.files.length===(selected.bodyFile?6:5)&&m.files.find(f=>f.name==='response.bin')?.sha256===verified.sha256&&
      m.files.find(f=>f.name==='response.bin')?.bytes===verified.bytes,
      'RUBY_CUSTOMER_MANIFEST_INVALID');
    return {directory:output,manifest:m,manifestSha256:sha(bytes),files:m.files,source:'ORIGINAL_SAVED_BUYER_RESPONSE'};
  }
  if(complete)return verifyCompletion(complete);
  const planPath=join(output,'.receiving-plan.json');let planBytes=await optional(planPath);
  if(!planBytes){
    const review=await operation.review({signal:abort.signal});
    const payloads={'source.json':json(selected.source),'request.json':json(selected.source.request),
      'review.json':json(review),'result.json':json(result.record)};
    if(selected.bodyFile)payloads['request.body']=await read(selected.bodyFile,16*1024*1024);
    const plan={schema:'stellar-forge.ruby-receiving-plan.v1',intentId:operation.intentId,
      sourceSha256:selected.source.sourceSha256,configSha256:selected.source.configSha256,
      bodySha256:selected.source.nativeBodySha256,responseSha256:verified.sha256,responseBytes:verified.bytes,
      files:Object.entries(payloads).map(([name,data])=>({name,bytes:data.length,sha256:sha(data),data:data.toString('base64')}))};
    planBytes=json(plan);await once(planPath,planBytes);
  }
  const plan=JSON.parse(decode(planBytes));
  need(plan.schema==='stellar-forge.ruby-receiving-plan.v1'&&plan.intentId===operation.intentId&&
    plan.sourceSha256===selected.source.sourceSha256&&plan.configSha256===selected.source.configSha256&&
    plan.bodySha256===selected.source.nativeBodySha256&&plan.responseSha256===verified.sha256&&plan.responseBytes===verified.bytes&&
    Array.isArray(plan.files),'RUBY_CUSTOMER_SELECTION_CHANGED');
  const expectedNames=['source.json','request.json','review.json','result.json',...(selected.bodyFile?['request.body']:[])];
  need(plan.files.length===expectedNames.length&&new Set(plan.files.map(f=>f.name)).size===expectedNames.length,'RUBY_RECEIVING_PLAN_CHANGED');
  for(const f of plan.files){
    need(expectedNames.includes(f.name)&&typeof f.data==='string','RUBY_RECEIVING_PLAN_CHANGED');
    const bytes=Buffer.from(f.data,'base64');
    need(bytes.toString('base64')===f.data&&bytes.length===f.bytes&&sha(bytes)===f.sha256,'RUBY_RECEIVING_PLAN_CHANGED');
    await once(join(output,f.name),bytes);
  }
  const responsePath=join(output,'response.bin');
  try{await verifySaved(responsePath,verified);}
  catch(e){if(e.code!=='ENOENT')throw e;await result.saveAs(responsePath,{signal:abort.signal});}
  const manifest={schema:'stellar-forge.ruby-customer-delivery.v1',intentId:plan.intentId,
    sourceSha256:plan.sourceSha256,configSha256:plan.configSha256,bodySha256:plan.bodySha256,
    responseSha256:plan.responseSha256,
    files:[...plan.files.map(({name,bytes,sha256})=>({name,bytes,sha256})),{name:'response.bin',...verified}]};
  const manifestBytes=json(manifest);await once(manifestPath,manifestBytes);
  return verifyCompletion(manifestBytes);
}
let call,responsePath;
try{
  need(process.argv.length===3,'RUBY_CALL_FILE_REQUIRED');
  const path=resolve(process.argv[2]);await directory(dirname(path));
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=await file.stat();need(s.isFile()&&!(s.mode&0o077)&&s.size<=LIMIT,'RUBY_PRIVATE_CALL_REQUIRED');}
  finally{await file.close();}
  call=JSON.parse(decode(await read(path)));
  need(call.schema===SCHEMA&&/^[a-f0-9-]{36}$/.test(call.callId??'')&&plain(call.runtime)&&plain(call.arguments??{}),
    'RUBY_CALL_INVALID');
  need(['ready','prepare','review','inspect','execute','recover','receive'].includes(call.action),'RUBY_CALL_INVALID');
  responsePath=join(dirname(path),'response.json');
  need(await optional(responsePath)===null,'RUBY_CALL_ALREADY_RECORDED');
  const cfg=call.runtime;
  need(typeof cfg.runtimeDirectory==='string'&&isAbsolute(cfg.runtimeDirectory)&&
    typeof cfg.stateDirectory==='string'&&isAbsolute(cfg.stateDirectory),'RUBY_NATIVE_RUNTIME_REQUIRED');
  const {workspaceDirectory,...runtime}=cfg;
  need(Object.keys(runtime).every(k=>['runtimeDirectory','stateDirectory','operatorProfile','timeoutMs','outputLimit'].includes(k)),
    'RUBY_NATIVE_RUNTIME_FIELDS_INVALID');
  const entry=join(resolve(cfg.runtimeDirectory),'node','index.mjs');
  need((await lstat(entry)).isFile(),'RUBY_ORIGINAL_NODE_BUYER_REQUIRED');
  const {Buyer}=await import(pathToFileURL(entry).href);
  const buyer=new Buyer({...runtime,node:process.execPath,environment:process.env});
  await buyer.ready();
  const args=call.arguments??{};let result;
  if(call.action==='ready')result={runtimeDirectory:buyer.runtime.directory,stateDirectory:buyer.stateDirectory,
    implementation:'ORIGINAL_NODE_BUYER',node:process.version};
  else if(call.action==='prepare'){
    const source=boundSource(args.bound);need(call.id===source.record.request.intentId,'RUBY_INTENT_CHANGED');
    const options={body:source.body,signal:abort.signal,...(args.responseFile===undefined?{}:{responseFile:args.responseFile})};
    let operation=buyer.operation(call.id);
    if(await optional(join(operation.directory,'operation.json'),65536)===null){
      operation=workspaceDirectory===undefined
        ?await buyer.fromRequest({...source.record.request,...(source.body===undefined?{}:{body:source.body})},options)
        :await buyer.fromWorkspace(workspaceDirectory,{configuration:{operation:source.record.request},
          intentId:call.id,...options});
    }
    const bound=await verifyBinding(operation,source);
    result={intentId:operation.intentId,directory:operation.directory,...bound};
  }else{
    need(ID.test(call.id??''),'RUBY_STABLE_INTENT_REQUIRED');
    const operation=buyer.operation(call.id),bound=await existingSource(operation);
    need(args.sourceSha256===bound.source.sourceSha256,'RUBY_SOURCE_SELECTION_REQUIRED');
    if(call.action==='inspect')result={...bound.info,source:bound.source};
    else if(call.action==='review')result=await operation.review({signal:abort.signal});
    else if(call.action==='execute')result=summary(await operation.execute({review:args.review,signal:abort.signal}));
    else if(call.action==='recover')result=summary(await operation.recover());
    else result=await receive(operation,args.directory);
  }
  await once(responsePath,json({schema:SCHEMA,callId:call.callId,action:call.action,id:call.id??null,ok:true,result}));
}catch(error){
  if(responsePath&&call){
    try{await once(responsePath,json({schema:SCHEMA,callId:call.callId,action:call.action,id:call.id??null,ok:false,
      error:{code:safeCode(error),...(Number.isInteger(error.exitCode)?{exitCode:error.exitCode}:{})}}));}
    catch{process.exitCode=2;}
  }
  process.exitCode??=1;
}finally{
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
