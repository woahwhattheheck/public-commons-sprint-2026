// MIT. Operate one real RisingWave source through the original complete workbench.
// Source documents remain unchanged. Only explicitly described receiving metadata
// in this operation's own tables is mutated to exercise native change semantics.
import assert from 'node:assert/strict';
import { open, readFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireWorkspace } from '../../postgres/publisher/files.mjs';
import { privateDirectory, readBytes, optionalJson, atomicJson, createFile, bytes, identity, qualified,
  identifier, fail, errorValue, SOURCE_PIN, writeAll, syncDirectory } from '../common.mjs';
import { validateRisingWaveSource, openRisingWaveSourceFile } from '../config.mjs';
import { compileRisingWaveReport } from '../report.mjs';
import { connectRisingWave, rowsAsObjects } from '../transport.mjs';
import { readRelation } from '../catalogue.mjs';
import { readRisingWaveCapture, readRisingWaveRows } from '../source.mjs';

const execute=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex');
const HASH=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
const need=(value,code,message=code)=>{if(!value)throw fail(code,message);};
const atomic=(path,value)=>atomicJson(path,value);
async function immutable(path,value,raw=false){
  const content=raw?value:bytes(value);
  try{await createFile(path,content);await syncDirectory(dirname(path));}
  catch(issue){if(issue.code!=='EEXIST')throw issue;assert.deepEqual(await readFile(path),content,'Retained input changed: '+path);}
}
async function append(path,value){
  const file=await open(path,'a',0o600);
  try{await writeAll(file,JSON.stringify(value)+'\n');await file.sync();}finally{await file.close();}
}
function publicSourceUrl(value){
  let url;try{url=new URL(value);}catch{throw fail('NATIVE_SOURCE_URL_REQUIRED');}
  need(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'NATIVE_SOURCE_URL_INVALID');
  return url.href;
}
// Locate original JSON values by byte-preserving character ranges. JSON.parse is
// used only for validation/structure; no parsed number is written back to source.
function inputRecords(text,pointer){
  const parsed=JSON.parse(text);
  need(pointer===''||/^\/(?:[^/~]|~0|~1)+$/.test(pointer),'NATIVE_RECORDS_POINTER_INVALID',
    'Select the array root with an empty pointer or one top-level array field such as /records.');
  const white=at=>{while(/\s/.test(text[at]??'')&&at<text.length)at++;return at;};
  function endValue(start){
    let at=white(start),stack=[],quoted=false,escaped=false;
    if(text[at]==='"'){for(at++;at<text.length;at++){if(escaped){escaped=false;continue;}if(text[at]==='\\'){escaped=true;continue;}if(text[at]==='"')return at+1;}throw fail('NATIVE_SOURCE_JSON_INVALID');}
    if(text[at]==='{'||text[at]==='['){
      for(;at<text.length;at++){
        const c=text[at];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
        if(c==='"'){quoted=true;continue;}if(c==='{'||c==='[')stack.push(c);
        if(c==='}'||c===']'){const before=stack.pop();need(before===(c==='}'?'{':'['),'NATIVE_SOURCE_JSON_INVALID');if(!stack.length)return at+1;}
      }throw fail('NATIVE_SOURCE_JSON_INVALID');
    }
    while(at<text.length&&!/[\s,\]}]/.test(text[at]))at++;return at;
  }
  let start=white(0),selected=parsed;
  if(pointer){
    const wanted=pointer.slice(1).replaceAll('~1','/').replaceAll('~0','~');
    need(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),'NATIVE_SOURCE_ENVELOPE_REQUIRED');
    let at=white(start+1),found=null;
    while(text[at]!=='}'){
      const end=endValue(at),key=JSON.parse(text.slice(at,end));at=white(end);need(text[at]===':','NATIVE_SOURCE_JSON_INVALID');at=white(at+1);
      const valueEnd=endValue(at);if(key===wanted){need(found===null,'NATIVE_SOURCE_DUPLICATE_ARRAY_FIELD');found=at;}
      at=white(valueEnd);if(text[at]===',')at=white(at+1);else break;
    }
    need(found!==null,'NATIVE_RECORDS_ARRAY_MISSING');start=found;selected=parsed[wanted];
  }
  need(Array.isArray(selected)&&selected.length>=64&&selected.length<=10000,'NATIVE_SOURCE_ROW_RANGE',
    'Use 64–10000 original source records for the complete native receiving operation.');
  need(text[start]==='[','NATIVE_RECORDS_ARRAY_MISSING');
  const rows=[];let at=white(start+1);
  while(text[at]!==']'){
    const end=endValue(at),raw=text.slice(at,end),value=JSON.parse(raw);
    need(value&&typeof value==='object'&&!Array.isArray(value),'NATIVE_SOURCE_RECORD_REQUIRED');
    need(Buffer.byteLength(raw)<=131072,'NATIVE_SOURCE_RECORD_TOO_LARGE');
    rows.push({ordinal:rows.length+1,raw,sha256:hash(raw),from:at,to:end});
    at=white(end);if(text[at]===',')at=white(at+1);else break;
  }
  need(text[at]===']'&&rows.length===selected.length,'NATIVE_SOURCE_ARRAY_INCOMPLETE');return rows;
}
function technicalRow(record,sourceHash){
  const publicKey=String(9007199254740993n+BigInt(record.ordinal));
  return{...record,storageId:String(record.ordinal),publicKey,
    sourceId:sourceHash+':'+record.ordinal,
    decimal:publicKey+'.'+String(BigInt('0x'+record.sha256.slice(0,15))%1000000000000000000n).padStart(18,'0')};
}
function declaration(relation,subscription){
  const types={storage_id:'bigint',public_key:'bigint',source_id:'string',source_sha:'string',
    source_text:'string',source_document:'json',source_url:'string',priority:'integer',included:'boolean',
    exact_decimal:'decimal',observed_at:'timestamptz',null_note:'string',empty_note:'string',side_note:'string'};
  return compileRisingWaveReport({relation,subscription,key:['public_key'],
    columns:Object.fromEntries(Object.entries(types).map(([name,type])=>[name,{column:name,type,
      nullable:['null_note','empty_note','side_note'].includes(name)}])),
    parameters:{minimumPriority:{type:'integer',min:0,max:10},include:{type:'boolean'},
      selectedKeys:{type:'bigint',array:true,required:false,maxItems:10000}},
    filters:[{column:'priority',op:'gte',parameter:'minimumPriority'},{column:'included',op:'eq',parameter:'include'},
      {column:'public_key',op:'in',parameter:'selectedKeys'}],
    probe:{minimumPriority:0,include:true},maxRows:20,maxBytes:1048576,
    description:'Original source documents with explicitly derived receiving identities and operator review fields. The visible public key deliberately differs from storage_id.'});
}
function sourceConfiguration(options,relation,subscription,retentionRelation,retentionSubscription){
  return{schema:'stellar-forge.risingwave-source.v1',connectionStringEnv:options.connectionStringEnv,tls:options.tls,
    allowLocal:options.allowLocal,...(options.caFileEnv?{caFileEnv:options.caFileEnv}:{}),maxInFlight:1,queryTimeoutMs:120000,
    queries:{documents:declaration(relation,subscription),retention:declaration(retentionRelation,retentionSubscription)}};
}
const tableDefinition='(storage_id BIGINT PRIMARY KEY,public_key BIGINT NOT NULL,source_id TEXT NOT NULL,'+
 'source_sha TEXT NOT NULL,source_text TEXT NOT NULL,source_document JSONB NOT NULL,source_url TEXT NOT NULL,'+
 'priority INTEGER NOT NULL,included BOOLEAN NOT NULL,exact_decimal DECIMAL(38,18) NOT NULL,observed_at TIMESTAMPTZ NOT NULL,'+
 'null_note TEXT,empty_note TEXT,side_note TEXT)';
const selectedFields='storage_id,public_key,source_id,source_sha,source_text,source_document,source_url,priority,included,exact_decimal,observed_at,null_note,empty_note,side_note';
function shortCapture(value){
  return{id:value.manifest.id,directory:value.directory,rowCount:value.manifest.rowCount,sourceRowCount:value.manifest.sourceRowCount,
    sourceHash:value.manifest.sourceHash,requestHash:value.manifest.requestHash,query:value.manifest.query,input:value.manifest.input,
    mode:value.manifest.mode,effectiveMode:value.manifest.effectiveMode,checkpoint:value.manifest.checkpoint,
    events:value.manifest.events,barrier:value.manifest.barrier,orderedRowsSha256:value.manifest.orderedRowsSha256,
    eventRecoveries:value.manifest.eventRecoveries??[],archives:value.manifest.archives,files:value.files};
}
function exactNativeDecimal(value){
  need(typeof value==='string'&&value.length<=128,'NATIVE_DECIMAL_TEXT_REQUIRED');
  const match=/^([+-]?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value);
  need(match,'NATIVE_DECIMAL_LEXEME_INVALID');
  const exponent=Number(match[4]??0);need(Number.isSafeInteger(exponent)&&Math.abs(exponent)<=128,'NATIVE_DECIMAL_EXPONENT_INVALID');
  let coefficient=BigInt((match[1]==='-'?'-':'')+match[2]+(match[3]??'')),scale=(match[3]?.length??0)-exponent;
  if(coefficient===0n)return'0:0';
  while(coefficient%10n===0n){coefficient/=10n;scale--;}
  return String(coefficient)+':'+String(scale);
}
function observedNativeRows(observation){
  const names=observation.fields.map(field=>field.name);
  assert.deepEqual(names,selectedFields.split(','));
  const rows=new Map();
  for(const raw of observation.rows){
    assert.equal(raw.length,names.length);
    const row=Object.fromEntries(names.map((name,index)=>[name,raw[index]]));
    for(const [name,value]of Object.entries(row))need(value===null||typeof value==='string','NATIVE_OBSERVATION_RAW_TEXT_REQUIRED',name);
    need(typeof row.storage_id==='string'&&/^[0-9]+$/.test(row.storage_id),'NATIVE_OBSERVATION_STORAGE_ID_INVALID');
    need(!rows.has(row.storage_id),'NATIVE_OBSERVATION_DUPLICATE_STORAGE_ID');
    need(typeof row.priority==='string'&&/^-?[0-9]+$/.test(row.priority),'NATIVE_OBSERVATION_PRIORITY_INVALID');
    const priority=Number(row.priority);need(Number.isSafeInteger(priority),'NATIVE_OBSERVATION_PRIORITY_INVALID');
    need(['t','f','true','false'].includes(row.included),'NATIVE_OBSERVATION_BOOLEAN_INVALID');
    rows.set(row.storage_id,{...row,priority,included:row.included==='t'||row.included==='true'});
  }
  assert.equal(rows.size,observation.rowCount);return rows;
}
function verifyObservedRow(row,observed,original){
  assert.ok(original,'Captured storage identity is outside the retained original source.');
  assert.ok(observed,'Captured row is absent from the retained complete native SELECT.');
  // Both observations use the native PGwire text representation in UTC. Preserve
  // DECIMAL and timestamp lexemes byte-for-byte; never compare through JS doubles
  // or Date milliseconds. Only the declared integer/boolean outputs are decoded.
  assert.deepEqual(row,observed,'Captured values differ from the independently observed native row.');
  assert.equal(row.source_sha,original.sha256);assert.equal(row.source_text,original.raw);
  assert.equal(hash(row.source_text),row.source_sha);assert.equal(row.source_id,original.sourceId);
  assert.equal(row.null_note,null);assert.equal(row.empty_note,'');
  assert.equal(typeof row.public_key,'string');assert.ok(BigInt(row.public_key)>BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(exactNativeDecimal(row.exact_decimal),exactNativeDecimal(original.decimal));
  assert.equal(typeof row.observed_at,'string');assert.equal(typeof row.source_document,'string');JSON.parse(row.source_document);
}
async function verifyRows(capture,records,observation){
  const source=new Map(records.map(row=>[row.storageId,row])),native=observedNativeRows(observation),seen=new Set(),storage=new Set();
  let count=0,empty=0,nulls=0;
  for await(const row of readRisingWaveRows(capture)){
    verifyObservedRow(row,native.get(row.storage_id),source.get(row.storage_id));
    assert.equal(row.included,true);
    assert.ok(!storage.has(row.storage_id),'Repeated captured storage identity.');storage.add(row.storage_id);
    assert.ok(!seen.has(row.public_key),'Visible key must be unique at the complete boundary.');seen.add(row.public_key);
    if(row.side_note===null)nulls++;else{assert.equal(row.side_note,'');empty++;}count++;
  }
  assert.equal(count,capture.manifest.rowCount);assert.equal(count,native.size);
  return{rows:count,sourceSha256Preserved:true,originalSourceTextPreserved:true,visibleKeys:seen.size,
    exactBigintText:true,exactDecimalText:true,timestampText:true,jsonText:true,nulls,empty,
    nativeObservation:{path:observation.file,bytes:observation.fileBytes,sha256:observation.fileSha256,
      requestHash:observation.requestHash,rowCount:observation.rowCount,observedAt:observation.observedAt},
    nativeBarrier:capture.manifest.barrier,ndjsonSha256:capture.files.ndjson.sha256};
}
async function eventSummary(capture){
  const input=await open(join(capture.directory,capture.files.events.path),'r'),hashValue=createHash('sha256');
  const operations={},epochs=new Set();let frames=0,recoveryFrames=0,quietBarriers=0;
  try{
    const stream=input.createReadStream({autoClose:false,start:0});
    stream.on('data',chunk=>hashValue.update(chunk));
    const lines=createInterface({input:stream,crlfDelay:Infinity});
    for await(const line of lines){
      const value=JSON.parse(line);frames++;
      if(value.schema==='stellar-forge.risingwave-native-fetch.v1'){
        for(const row of value.rows){const op=row.at(-2),timestamp=row.at(-1);operations[op]=(operations[op]??0)+1;if(timestamp!==null)epochs.add(timestamp);}
        if(value.nativeEof===true)quietBarriers++;
      }
      if(value.schema?.startsWith('stellar-forge.risingwave-event-recovery-'))recoveryFrames++;
    }
    assert.equal(hashValue.digest('hex'),capture.files.events.sha256);
  }finally{await input.close();}
  return{frames,operations,timestamps:[...epochs].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0),quietBarriers,recoveryFrames};
}
async function startMcpProcess({modulePath,url,environment,directory,label}){
  const child=spawn(process.execPath,[modulePath],{cwd:directory,shell:false,
    env:{...environment,RISINGWAVE_WORKSPACE_URL:url},stdio:['pipe','pipe','pipe']});
  const pending=new Map(),stderr=[],notifications=[];let serial=0,stderrBytes=0,ended=false,inputFailure=null;
  let closingRequested=false,closePromise=null,closedTrace=null;
  const failInput=issue=>{
    inputFailure??=Object.assign(new Error('Original MCP input stream failed.'),{code:'MCP_INPUT_FAILED',causeCode:issue?.code??null});
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(inputFailure);}pending.clear();
  };
  child.stdin.on('error',failInput);
  const terminal=new Promise(done=>child.once('close',(code,signal)=>{ended=true;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Object.assign(new Error('Original MCP process ended.'),{code:'MCP_PROCESS_ENDED'}));}pending.clear();done({code,signal});}));
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  lines.on('line',line=>{
    if(Buffer.byteLength(line)>8388608){child.kill('SIGTERM');return;}
    let value;try{value=JSON.parse(line);}catch{child.kill('SIGTERM');return;}
    if(Object.hasOwn(value,'id')){
      const item=pending.get(value.id);if(!item)return;
      pending.delete(value.id);clearTimeout(item.timer);
      value.error?item.reject(Object.assign(new Error(value.error.message),{code:'MCP_JSONRPC_ERROR',details:value.error})):item.resolve(value.result);
    }else if(notifications.length<20)notifications.push(value);
  });
  child.stderr.on('data',data=>{const remain=131072-stderrBytes;if(remain>0){const part=data.subarray(0,remain);stderr.push(part);stderrBytes+=part.length;}});
  await new Promise((done,reject)=>{child.once('spawn',done);child.once('error',reject);});
  function requireInput(){
    if(inputFailure)throw inputFailure;
    need(!ended,'MCP_PROCESS_ENDED');need(!closingRequested,'MCP_PROCESS_CLOSING');
  }
  function request(method,params){
    requireInput();const id=++serial;
    return new Promise((done,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(new Error('Original MCP request did not finish: '+method),{code:'MCP_REQUEST_TIMEOUT'}));},120000);
      pending.set(id,{resolve:done,reject,timer});
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,...(params===undefined?{}:{params})})+'\n',issue=>{
        if(issue){const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);item.reject(issue);}}
      });
    });
  }
  const notify=(method,params)=>{requireInput();return child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,...(params===undefined?{}:{params})})+'\n');};
  async function call(name,input={}){
    const result=await request('tools/call',{name,arguments:input});
    if(result?.isError){
      const detail=result.content?.find(value=>value.type==='text')?.text??'Original MCP tool failed';
      throw Object.assign(new Error(detail),{code:'MCP_TOOL_FAILED'});
    }
    if(result?.structuredContent)return result.structuredContent;
    const text=result?.content?.find(value=>value.type==='text')?.text;
    need(typeof text==='string','MCP_TOOL_RESULT_REQUIRED');return JSON.parse(text);
  }
  async function within(milliseconds){
    const timeout=new AbortController();
    try{return await Promise.race([terminal,delay(milliseconds,null,{signal:timeout.signal,ref:false})]);}
    finally{timeout.abort();}
  }
  async function close(){
    if(closedTrace)return closedTrace;
    if(closePromise)return closePromise;
    closingRequested=true;
    closePromise=(async()=>{
      if(!ended)try{child.stdin.end();}catch(issue){failInput(issue);}
      let result=await within(5000);
      if(!result){child.kill('SIGTERM');result=await within(5000);}
      if(!result){child.kill('SIGKILL');result=await within(5000);}
      need(result,'MCP_PROCESS_STILL_ACTIVE');
      lines.close();
      const trace={schema:'native.risingwave-mcp-process.v1',pid:child.pid,...result,
        requests:serial,notifications,inputFailure:inputFailure?{code:inputFailure.code,causeCode:inputFailure.causeCode}:null,
        stderr:Buffer.concat(stderr).toString('utf8')};
      await atomic(join(directory,label+'-mcp-process.json'),trace);closedTrace=trace;return trace;
    })();
    try{return await closePromise;}finally{closePromise=null;}
  }
  return{pid:child.pid,request,notify,call,close};
}

export async function runRisingWaveNativeJourney({directory,inputFile,inputSha256,sourceUrl,recordsPointer='/records',
  connectionStringEnv='RISINGWAVE_URL',tls='require',allowLocal=false,caFileEnv,initialize=false,
  sourcePin=null,environment=process.env,onOpen=async()=>{},onEvent=()=>{}}={}){
  need(typeof directory==='string'&&typeof inputFile==='string'&&HASH.test(inputSha256??'')&&
    (sourcePin===null||COMMIT.test(sourcePin))&&typeof onOpen==='function','NATIVE_ARGUMENTS_REQUIRED');
  directory=resolve(directory);inputFile=resolve(inputFile);sourceUrl=publicSourceUrl(sourceUrl);
  const original=await readBytes(inputFile,16777216,false);
  assert.equal(hash(original),inputSha256,'Use the exact original source byte digest.');
  const records=inputRecords(new TextDecoder('utf-8',{fatal:true}).decode(original),recordsPointer).map(row=>technicalRow(row,inputSha256));
  await privateDirectory(directory,true);
  const release=await acquireWorkspace(directory),startedAt=new Date().toISOString(),attempt=randomUUID();
  try{
  let session=null,client=null,control=null,mcp=null,source=null,result=null,failure=null,publicationId=null,attemptRegistered=false;
  let progress=await optionalJson(join(directory,'journey-progress.json'))??
    {schema:'native.risingwave-source-progress.v1',startedAt,attempts:[],mutations:{}};
  const save=async patch=>{Object.assign(progress,patch);await atomic(join(directory,'journey-progress.json'),progress);};
  const event=async(name,detail={})=>{await save({lastEvent:{name,at:new Date().toISOString(),...detail}});await onEvent({event:name,...detail});};
  const runId=progress.caseId??hash(inputSha256+'\n'+directory).slice(0,16),schema='commons_rw_'+runId;
  const relation={schema,name:'documents'},subscription={schema,name:'documents_changes'};
  const retentionRelation={schema,name:'retention_documents'},retentionSubscription={schema,name:'retention_changes'};
  const configuration=sourceConfiguration({connectionStringEnv,tls,allowLocal,caFileEnv},relation,subscription,retentionRelation,retentionSubscription);
  validateRisingWaveSource(configuration);
  const requested={schema:'native.risingwave-source-case.v1',caseId:runId,relation,subscription,retentionRelation,retentionSubscription,
    input:{file:'source-input.json',sha256:inputSha256,bytes:original.length,recordsPointer,records:records.length,sourceUrl},
    sourceProtocol:{version:'3.1.0',commit:SOURCE_PIN},sourceDefinitionSha256:hash(bytes(configuration)),
    connectionReferences:{connectionStringEnv,tls,allowLocal,caFileEnv:caFileEnv??null},
    technicalFields:{storage_id:'One-based original input row position; native storage primary key.',
      public_key:'Exact BIGINT 9007199254740993 + original row position; reviewed visible key.',
      source_id:'Original input SHA256 followed by source row position.',
      source_sha:'SHA256 of the exact original JSON row text.',
      source_text:'Exact original row substring; numeric lexemes remain unchanged.',
      source_document:'Native JSONB interpretation of source_text; the original text remains alongside it.',
      exact_decimal:'Exact technical public-key integer with a deterministic eighteen-digit source-hash fraction.',
      observed_at:'Actual native server timestamp retained once for this receiving operation.',
      priority:'Operator review priority; this is receiving metadata.',
      included:'Operator review inclusion; this is receiving metadata.',
      null_note:'Native NULL representation field.',empty_note:'Native empty-text representation field.',
      side_note:'Native NULL for odd source ordinals; empty text for even ordinals.'}};
  const workspaceDirectory=join(directory,'workbench'),sourceFile=join(directory,'source.json'),
    connectionFile=join(directory,'connection.json'),merchantFile=join(directory,'merchant.json');
  const paymentOptions=[
    {scheme:'exact',network:'stellar:testnet',asset:'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      payTo:'GDWR665E7ES4TIQBDAFJMWSEF6Z4GW7DJJLDCVUSDSXXZL6FPQYN2UL5',amount:'900719925474099312345',
      maxTimeoutSeconds:60,extra:{name:'Retained RisingWave document dataset',version:'1'}},
    {scheme:'exact',network:'stellar:testnet',asset:'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      payTo:'GDC5QPBHAXNKAGL2O4IU4CUTUPF5FLHRUWZG3OVLSMHDU3MCXSHBY4JB',amount:'10001',maxTimeoutSeconds:60}];
  const merchant={publicOrigin:'https://risingwave-demo.example',description:'Retained source documents and native materialized editions',
    serviceName:'RisingWave native operator',tags:['risingwave','native','dataset'],paymentOptions};
  let verifies=0,settlements=0,paidRequests=0;
  const facilitatorClient={
    async getSupported(){return{kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet'}],extensions:['bazaar'],signers:{}};},
    async verify(){verifies++;return{isValid:true,payer:'disposable-risingwave-native-payer'};},
    async settle(){settlements++;return{success:true,transaction:hash('disposable-risingwave-native-'+settlements),network:'stellar:testnet'};}
  };
  const extraction={maxRows:records.length+16,maxBytes:268435456,maxRowBytes:1048576,batchSize:1000,timeoutSeconds:0,maxDurationMs:600000};
  const captureInput={minimumPriority:0,include:true};
  const command=(action,input={})=>client.publicationCommand(publicationId,action,input);
  async function sql(statement,values=[],label='native-query',{retainRows=false,sourceRows=null}={}){
    const request={id:randomUUID(),label,at:new Date().toISOString(),statement,
      ...(sourceRows?{sourceRows,parametersSha256:hash(JSON.stringify(values))}:{parameters:values})};
    await append(join(directory,'native-commands.ndjson'),{...request,state:'REQUESTED'});
    try{
      const reply=await control.query(statement,values,{phase:'native-receiving',timeoutMs:120000});
      await append(join(directory,'native-commands.ndjson'),{id:request.id,state:'RETURNED',at:new Date().toISOString(),
        response:{command:reply.command,rowCount:reply.rowCount,fields:reply.fields,rowsSha256:hash(JSON.stringify(reply.rows)),
          ...(retainRows?{rows:reply.rows}:{})}});
      return reply;
    }catch(issue){await append(join(directory,'native-commands.ndjson'),{id:request.id,state:'FAILED',at:new Date().toISOString(),error:errorValue(issue)});throw issue;}
  }
  const flush=label=>sql('FLUSH',[],label);
  async function visible(reference){
    return rowsAsObjects(await sql('SELECT '+selectedFields+' FROM '+qualified(reference)+' ORDER BY storage_id',[],'read-owned-source'));
  }
  async function observeNativeEdition(label,capture,reference,{selected=records,swapped=false}={}){
    need(/^[a-z][a-z0-9-]+$/.test(label),'NATIVE_OBSERVATION_LABEL_INVALID');
    const path=join(directory,'native-'+label+'-observation.json');
    const statement='SELECT '+selectedFields+' FROM '+qualified(reference)+
      ' WHERE included=$1::boolean AND priority >= $2::integer ORDER BY storage_id';
    const request={captureId:capture.manifest.id,manifestSha256:capture.files.manifest.sha256,
      sourceHash:capture.manifest.sourceHash,query:capture.manifest.query,input:capture.manifest.input,
      relation:reference,endpoint:control.identity.endpoint,statement,parameters:[true,0],
      publicKeyMapping:swapped?'first-two-original-keys-swapped':'original-source-ordinal'};
    const requestHash=identity(request);
    let observation=await optionalJson(path,134217728);
    if(observation){
      assert.equal(observation.schema,'native.risingwave-complete-row-observation.v1');
      assert.equal(observation.requestHash,requestHash,'The retained native edition observation binds another capture.');
      assert.deepEqual(observation.request,request);
      assert.equal(observation.rowsSha256,hash(bytes(observation.rows)));
      assert.equal(observation.fieldsSha256,hash(bytes(observation.fields)));
    }else{
      const before=await readRelation(control,reference);
      assert.equal(before.id,capture.manifest.sourceIdentity.relation.id,'The original native relation was replaced.');
      const reply=await sql(statement,request.parameters,'observe-complete-'+label);
      const after=await readRelation(control,reference);
      assert.deepEqual(after,before,'The native relation schema changed during the independent observation.');
      assert.deepEqual(reply.fields.map(field=>field.name),selectedFields.split(','));
      assert.equal(reply.rowCount,reply.rows.length);
      observation={schema:'native.risingwave-complete-row-observation.v1',request,requestHash,
        observedAt:new Date().toISOString(),relation:before,fields:reply.fields,fieldsSha256:hash(bytes(reply.fields)),
        rows:reply.rows,rowsSha256:hash(bytes(reply.rows)),rowCount:reply.rows.length};
    }
    const original=new Map(selected.map(row=>[row.storageId,row])),native=observedNativeRows(observation);
    assert.equal(native.size,capture.manifest.rowCount);
    for(const [storageId,row]of native){
      const expected=original.get(storageId);assert.ok(expected,'Native observation contains an undeclared source row.');
      const publicKey=swapped&&storageId==='1'?records[1].publicKey:swapped&&storageId==='2'?records[0].publicKey:expected.publicKey;
      assert.equal(row.public_key,publicKey,'The native BIGINT or explicit key swap differs from its exact reviewed value.');
      assert.equal(exactNativeDecimal(row.exact_decimal),exactNativeDecimal(expected.decimal));
      assert.equal(row.observed_at,progress.observedAt,'Native timestamp text differs from the original inserted native timestamp.');
      assert.equal(row.included,true);assert.equal(row.source_url,sourceUrl);
      assert.equal(row.source_sha,expected.sha256);assert.equal(row.source_text,expected.raw);assert.equal(row.source_id,expected.sourceId);
    }
    // The original operation owns this quiescent table. Commit the full native
    // observation before permitting a later mutation; restart reuses these bytes.
    if(!await optionalJson(path,134217728))await atomic(path,observation);
    const retained=await readBytes(path,134217728,true);assert.deepEqual(JSON.parse(retained),observation);
    return{...observation,file:path,fileBytes:retained.length,fileSha256:hash(retained)};
  }
  async function seed(reference,selected,label){
    let present;
    try{present=await readRelation(control,reference);}
    catch(issue){
      if(issue.code!=='RISINGWAVE_RELATION_NOT_FOUND')throw issue;
      need(initialize,'NATIVE_INITIALIZATION_REQUIRED','Use --initialize for the first operation on its own source schema and tables.');
      await sql('CREATE TABLE IF NOT EXISTS '+qualified(reference)+' '+tableDefinition,[],'create-'+label);
      present=await readRelation(control,reference);
    }
    const expectedNames=selectedFields.split(',');
    assert.deepEqual(present.columns.map(column=>column.name),expectedNames,'An existing owned table has another column contract.');
    assert.deepEqual(present.primaryKey,['storage_id']);
    const key=label+'Seed',prior=progress[key];
    if(prior)assert.equal(present.id,prior.relation.id,'The original native table was replaced.');
    if(prior&&label==='documents'&&progress.mutations['delete-insert-original-last-row']&&
        progress.mutations['delete-insert-original-last-row'].state!=='COMPLETE')await removeAndReturn();
    await flush('flush-before-'+label+'-seed');
    const before=await visible(reference),known=new Map(before.map(row=>[row.storage_id,row]));
    const permitted=new Map(selected.map(row=>[row.storageId,row]));
    for(const row of before){
      const expected=permitted.get(row.storage_id);assert.ok(expected,'The owned table contains an undeclared source row.');
      assert.equal(row.source_sha,expected.sha256);assert.equal(row.source_text,expected.raw);assert.equal(row.source_id,expected.sourceId);
    }
    if(!prior){
      const missing=selected.filter(row=>!known.has(row.storageId));
      for(let at=0;at<missing.length;at+=25){
        const batch=missing.slice(at,at+25),values=[],tuples=[];
        for(const row of batch){
          const start=values.length;
          values.push(row.storageId,row.publicKey,row.sourceId,row.sha256,row.raw,row.raw,sourceUrl,'0','true',
            row.decimal,progress.observedAt,null,'',row.ordinal%2?null:'');
          const casts=['bigint','bigint','text','text','text','jsonb','text','integer','boolean','decimal','timestamptz','text','text','text'];
          tuples.push('('+casts.map((type,i)=>'$'+(start+i+1)+'::'+type).join(',')+')');
        }
        await sql('INSERT INTO '+qualified(reference)+' ('+selectedFields+') VALUES '+tuples.join(','),values,'seed-'+label,
          {sourceRows:batch.map(row=>({ordinal:row.ordinal,sha256:row.sha256}))});
      }
      await flush('flush-complete-'+label+'-seed');
    }
    const after=await visible(reference);
    assert.equal(after.length,selected.length,'Do not reseed a retained operation whose source rows changed.');
    for(const row of after){const expected=permitted.get(row.storage_id);assert.equal(row.source_sha,expected.sha256);assert.equal(row.source_text,expected.raw);}
    const outcome={relation:present,rows:after.length,inputSha256,sourceRowsSha256:hash(JSON.stringify(after.map(row=>[row.storage_id,row.source_sha])))};
    if(!prior)await save({[key]:outcome});return outcome;
  }
  async function setRows(key,reference,changes){
    const wanted=changes.map(value=>({...value,storageId:String(value.storageId)}));
    const digest=identity({reference,changes:wanted}),old=progress.mutations[key];
    if(old){assert.equal(old.requestHash,digest,'The retained native mutation intent changed.');if(old.state==='COMPLETE')return old;}
    else{progress.mutations[key]={requestHash:digest,reference,changes:wanted,state:'PREPARED'};await save({});}
    const current=rowsAsObjects(await sql('SELECT storage_id,public_key,priority,included FROM '+qualified(reference)+
      ' WHERE storage_id=ANY($1::bigint[]) ORDER BY storage_id',[wanted.map(row=>row.storageId)],'inspect-'+key,{retainRows:true}));
    assert.equal(current.length,wanted.length);
    const matches=(row,change)=>Object.entries(change).filter(([name])=>name!=='storageId').every(([name,value])=>
      row[name]===String(value)||(typeof value==='boolean'&&row[name]===(value?'t':'f')));
    const pending=wanted.filter(change=>!matches(current.find(row=>row.storage_id===change.storageId),change));
    if(pending.length){
      const values=[],set=[];
      for(const column of ['public_key','priority','included']){
        const selected=pending.filter(row=>Object.hasOwn(row,column));if(!selected.length)continue;
        let expression='CASE storage_id ';
        for(const row of selected){values.push(row.storageId,row[column]);expression+='WHEN $'+(values.length-1)+'::bigint THEN $'+values.length+'::'+
          (column==='public_key'?'bigint':column==='priority'?'integer':'boolean')+' ';}
        set.push(identifier(column)+'='+expression+'ELSE '+identifier(column)+' END');
      }
      values.push(pending.map(row=>row.storageId));
      await sql('UPDATE '+qualified(reference)+' SET '+set.join(',')+' WHERE storage_id=ANY($'+values.length+'::bigint[])',values,key);
    }
    await flush('flush-'+key);
    const after=rowsAsObjects(await sql('SELECT storage_id,public_key,priority,included FROM '+qualified(reference)+
      ' WHERE storage_id=ANY($1::bigint[]) ORDER BY storage_id',[wanted.map(row=>row.storageId)],'verify-'+key,{retainRows:true}));
    for(const change of wanted)assert.ok(matches(after.find(row=>row.storage_id===change.storageId),change));
    Object.assign(progress.mutations[key],{state:'COMPLETE',completedAt:new Date().toISOString(),rows:after,
      reconciliation:pending.length===0?'desired-native-values-already-present':'native-update-and-flush'});
    await save({});return progress.mutations[key];
  }
  async function captureRecord(selected){
    try{return await client.captureRecord(selected);}catch(issue){if(issue.status===404||issue.code==='ENOENT')return null;throw issue;}
  }
  async function ensureCapture(label,{query='documents',mode='full',onGap='error',baseCaptureId=null,batchSize=1000}={}){
    const selected=progress[label+'Id']??'capture-native-'+label+'-'+randomUUID();
    if(!progress[label+'Id'])await save({[label+'Id']:selected});
    let record=await captureRecord(selected);
    if(!record)record=await client.capture({expectedRevision:progress.sourceRevision,query,input:captureInput,captureId:selected,
      mode,onGap,...(baseCaptureId?{baseCaptureId}:{}),extraction:{...extraction,batchSize}});
    return record;
  }
  async function waitCapture(selected,{observe=async()=>{},resume=false}={}){
    let record=await client.captureRecord(selected);
    if(resume&&record.state!=='COMPLETE')record=await client.resumeCapture(selected);
    const deadline=Date.now()+660000;
    while(record.state==='CAPTURING'){
      need(Date.now()<deadline,'NATIVE_CAPTURE_WAIT_EXCEEDED');
      await observe(record);await delay(5);record=await client.captureRecord(selected);
    }
    if(record.state!=='COMPLETE'){
      try{record=await client.recoverCapture(selected);}catch{}
    }
    assert.equal(record.state,'COMPLETE',JSON.stringify({id:selected,state:record.state,error:record.error}));
    return readRisingWaveCapture(record.directory);
  }
  async function waitForPartial(selected,predicate){
    const deadline=Date.now()+600000;
    for(;;){
      const record=await client.captureRecord(selected);
      assert.equal(record.state,'CAPTURING','The native capture completed before its requested interruption: '+JSON.stringify(record.error));
      if(predicate(record.progress??{})){
        await immutable(join(directory,selected+'-before-cancel.json'),record);
        const cancelled=await client.cancelCapture(selected);
        assert.ok(['CANCELLED','FAILED','INTERRUPTED'].includes(cancelled.state),'The operation had already completed.');
        await immutable(join(directory,selected+'-cancelled.json'),cancelled);return cancelled;
      }
      need(Date.now()<deadline,'NATIVE_PARTIAL_CAPTURE_NOT_OBSERVED');await delay(5);
    }
  }

  async function touch(key,reference,storageId='1'){
    const retained=progress.mutations[key];
    if(retained?.state==='COMPLETE')return retained;
    const changes=retained?.changes??[{storageId,priority:(Number(rowsAsObjects(await sql(
      'SELECT priority FROM '+qualified(reference)+' WHERE storage_id=$1::bigint',[storageId],'read-'+key,{retainRows:true}))[0].priority)+1)%11}];
    return setRows(key,reference,changes);
  }
  async function removeAndReturn(){
    const record=records.at(-1),key='delete-insert-original-last-row';
    let intent=progress.mutations[key];
    if(!intent){intent={state:'PREPARED',storageId:record.storageId,sourceSha256:record.sha256};progress.mutations[key]=intent;await save({});}
    assert.equal(intent.sourceSha256,record.sha256);
    if(intent.state==='COMPLETE')return intent;
    if(!intent.deleted){
      await sql('DELETE FROM '+qualified(relation)+' WHERE storage_id=$1::bigint',[record.storageId],'native-delete-source-row');
      await flush('flush-native-delete');
      assert.equal((await sql('SELECT storage_id FROM '+qualified(relation)+' WHERE storage_id=$1::bigint',[record.storageId])).rows.length,0);
      intent.deleted={at:new Date().toISOString()};await save({});
    }
    const existing=rowsAsObjects(await sql('SELECT source_sha,source_text FROM '+qualified(relation)+' WHERE storage_id=$1::bigint',[record.storageId]));
    if(!existing.length){
      const values=[record.storageId,record.publicKey,record.sourceId,record.sha256,record.raw,record.raw,sourceUrl,'0','true',
        record.decimal,progress.observedAt,null,'',record.ordinal%2?null:''];
      const casts=['bigint','bigint','text','text','text','jsonb','text','integer','boolean','decimal','timestamptz','text','text','text'];
      await sql('INSERT INTO '+qualified(relation)+' ('+selectedFields+') VALUES ('+casts.map((type,i)=>'$'+(i+1)+'::'+type).join(',')+')',
        values,'native-insert-original-source-row',{sourceRows:[{ordinal:record.ordinal,sha256:record.sha256}]});
      await flush('flush-native-insert');
    }else{assert.equal(existing.length,1);assert.equal(existing[0].source_sha,record.sha256);assert.equal(existing[0].source_text,record.raw);}
    intent.state='COMPLETE';intent.completedAt=new Date().toISOString();await save({});return intent;
  }
  const dataset={name:'risingwave_documents',columns:Object.fromEntries(Object.entries(configuration.queries.documents.columns).map(([name,spec])=>
    [name,{type:['integer','number','boolean'].includes(spec.type)?spec.type:'string',nullable:spec.nullable}])),
    filters:['public_key','included'],ranges:[],sorts:['public_key'],maxCellChars:262144,defaultLimit:20,maxLimit:250,maxPageBytes:921600};
  async function extract(label){
    let plan,run;
    if(progress[label+'Plan'])plan=await command('plan',{plan:progress[label+'Plan']});
    else{
      const observed=await command('source');
      plan=await command('plan/save',{title:label==='first'?'Original included source edition':'Reviewed source membership and key changes',
        sourceHash:observed.hash,query:'documents',input:captureInput,dataset,
        extraction:{...extraction,mode:'auto',onGap:'error'}});
      await save({[label+'Plan']:plan.id});
    }
    let runId=progress[label+'Run'];
    if(!runId){
      const matches=(await client.publication(publicationId)).status.runs.filter(row=>row.plan===plan.id);
      need(matches.length<=1,'NATIVE_EXTRACTION_SELECTION_AMBIGUOUS');
      runId=matches[0]?.id??(await command('extract/start',{plan:plan.id})).id;
      await save({[label+'Run']:runId});
    }
    const deadline=Date.now()+660000;
    for(;;){
      run=(await client.run(publicationId,runId)).run;
      if(run.state!=='EXTRACTING')break;
      need(Date.now()<deadline,'NATIVE_PUBLICATION_WAIT_EXCEEDED');await delay(100);
    }
    if(['FAILED','INTERRUPTED','CANCELLED','PUBLICATION_UNKNOWN'].includes(run.state)){
      try{run=await command('recover',{id:runId});}catch{}
    }
    need(['READY','REVIEWED','PUBLISHED','PUBLICATION_UNKNOWN'].includes(run.state),'NATIVE_EXTRACTION_NOT_COMPLETE',JSON.stringify(run.data.error));
    const candidate=run.data.candidate,capture=await readRisingWaveCapture(candidate.extraction.capture.directory);
    assert.equal(candidate.extraction.capture.manifestSha256,capture.files.manifest.sha256);
    assert.equal(candidate.dataset.rowCount,capture.manifest.rowCount);assert.equal(candidate.dataset.nullEncoding,'unquoted-empty');
    await save({[label+'PublicationCapture']:shortCapture(capture)});
    return{plan,run,candidate,capture};
  }
  async function publish(value,initial=false){
    let run=value.run;
    if(run.state==='PUBLICATION_UNKNOWN')run=await command('recover',{id:run.id});
    if(run.state!=='PUBLISHED'){
      if(run.state!=='REVIEWED'){
        const target=await client.publication(publicationId);
        run=await command('review',{id:run.id,reviewer:'Commons native operator',
          note:'Complete native source boundary and exact source rows, key changes, NULL, empty text, BIGINT, DECIMAL and timestamp representations reviewed.',
          ...(initial?{initialize:true}:{expectedSnapshot:target.target.versions.current,expectedRevision:target.target.versions.revision})});
      }
      run=await command('publish',{id:run.id,reviewId:run.data.review.id});
    }
    assert.equal(run.state,'PUBLISHED',JSON.stringify(run.data.error));return run;
  }
  try{
    await immutable(join(directory,'case.json'),requested);await immutable(join(directory,'source-input.json'),original,true);
    const complete=await optionalJson(join(directory,'journey-result.json'));
    if(complete?.outcome==='PASS'){result=complete;return complete;}
    await privateDirectory(join(directory,'attempts'),true);
    progress.attempts.push({id:attempt,at:startedAt,sourcePin,node:process.version});
    progress.mutations??={};await save({caseId:runId});attemptRegistered=true;
    await immutable(connectionFile,{...configuration,queries:{}});await immutable(sourceFile,configuration);await immutable(merchantFile,merchant);
    control=await connectRisingWave(validateRisingWaveSource(configuration),{env:environment});
    if(progress.nativeIdentity)assert.deepEqual(control.identity.endpoint,progress.nativeIdentity.endpoint,'Use the original native receiving database.');
    else await save({nativeIdentity:control.identity});
    const schemas=rowsAsObjects(await sql('SELECT id,name FROM rw_catalog.rw_schemas WHERE name=$1',[schema],'inspect-owned-schema',{retainRows:true}));
    if(!schemas.length){
      need(initialize,'NATIVE_INITIALIZATION_REQUIRED','Use --initialize for the first operation on its own source schema.');
      await sql('CREATE SCHEMA IF NOT EXISTS '+identifier(schema),[],'create-owned-schema');
    }
    if(!progress.observedAt){
      const observed=rowsAsObjects(await sql('SELECT now() AS observed_at',[],'native-observation-time',{retainRows:true}))[0].observed_at;
      await save({observedAt:observed});
    }
    await seed(relation,records,'documents');await seed(retentionRelation,records.slice(0,8),'retention');
    const [{startRisingWaveWorkbench},{createRisingWaveWorkbenchClient},{createNativeSellerServer},{X402BuyerClient},{MCP_VERSION}]=await Promise.all([
      import('../workspace/server.mjs'),import('../workspace/client.mjs'),import('../../native-factory.mjs'),
      import('../../../sf31-buyer-client/buyer.mjs'),import('../../../../../stellar-forge/mcp-paid-agent/http-tools.mjs')]);
    const existing=await optionalJson(join(workspaceDirectory,'workspace.json'));
    session=await startRisingWaveWorkbench({directory:workspaceDirectory,environment,
      ...(!existing?{sourcePath:connectionFile,merchantPath:merchantFile}:{}),
      datasetNativeFactory:compiled=>createNativeSellerServer(compiled,{facilitatorClient})});
    client=await createRisingWaveWorkbenchClient({url:session.url,environment});
    let state=await client.state();
    if(!progress.discovery){
      const discovery=(await client.discover({expectedRevision:state.revision,schemas:[schema],relations:[relation,retentionRelation]})).catalogue;
      assert.ok(discovery.complete);assert.equal(discovery.relations.length,2);
      await immutable(join(directory,'discovery.json'),discovery);await save({discovery});
      await event('native-schema',{version:discovery.version,relations:discovery.relations.map(row=>({id:row.id,name:row.name,columns:row.columns.length}))});
    }
    if(!Object.keys(state.source.queries).length)state=await client.save({expectedRevision:state.revision,source:configuration,merchant});
    assert.equal(identity(state.source),identity(configuration));assert.equal(identity(state.merchant),identity(merchant));
    await save({sourceRevision:state.revision});
    for(const [query,retention]of [['documents','1 day'],['retention','30s']]){
      const requestId=progress[query+'SubscriptionRequest']??'subscription-native-'+query+'-'+randomUUID();
      if(!progress[query+'SubscriptionRequest'])await save({[query+'SubscriptionRequest']:requestId});
      const prepared=await client.subscriptionPrepare({expectedRevision:state.revision,query,requestId,retention});
      const created=await client.subscriptionCreate({expectedRevision:state.revision,requestId,reviewHash:prepared.review.reviewHash});
      assert.ok(['CREATED','EXISTING','RECONCILED'].includes(created.result.status));
      await save({[query+'Subscription']:created});
    }
    if(!progress.preview){
      const preview=await optionalJson(join(directory,'preview.json'))??
        await client.preview({expectedRevision:state.revision,query:'documents',input:captureInput});
      assert.equal(preview.sample.rowCount,20);assert.equal(preview.sample.truncated,true);
      assert.equal(preview.sample.rows[0].null_note,null);assert.equal(preview.sample.rows[0].empty_note,'');
      await immutable(join(directory,'preview.json'),preview);await save({preview});
    }
    if(!progress.typedArrayPreview){
      const selected=await optionalJson(join(directory,'typed-array-preview.json'))??
        await client.preview({expectedRevision:state.revision,query:'documents',
          input:{...captureInput,selectedKeys:[records[0].publicKey,records[1].publicKey]}});
      assert.equal(selected.sample.rowCount,2);assert.equal(selected.sample.truncated,false);
      assert.deepEqual(selected.sample.rows.map(row=>row.public_key).sort(),[records[0].publicKey,records[1].publicKey].sort());
      await immutable(join(directory,'typed-array-preview.json'),selected);await save({typedArrayPreview:selected});
    }
    assert.deepEqual(await optionalJson(join(directory,'typed-array-preview.json')),progress.typedArrayPreview,
      'Retain the completed original typed-array observation.');
    let quiet=await ensureCapture('quiet');
    const quietCapture=await waitCapture(quiet.id,{resume:quiet.state!=='COMPLETE'});
    assert.equal(quietCapture.manifest.sourceRowCount,records.length);
    assert.equal(quietCapture.manifest.checkpoint.lastTimestamp,null);
    assert.equal(quietCapture.manifest.checkpoint.resumeAvailable,false);
    assert.equal(quietCapture.manifest.barrier.state.kind,'InitLogStoreQuery');
    const quietObservation=await observeNativeEdition('quiet',quietCapture,relation);
    await save({quiet:shortCapture(quietCapture),quietChecks:await verifyRows(quietCapture,records,quietObservation)});
    await event('quiet-native-full',{rows:quietCapture.manifest.rowCount,resumeAvailable:false,
      barrier:quietCapture.manifest.barrier.state});
    if(!progress.quietChangesRefusal){
      let declined=await ensureCapture('quiet-changes',{mode:'changes',baseCaptureId:quiet.id});
      while(declined.state==='CAPTURING'){await delay(10);declined=await client.captureRecord(declined.id);}
      assert.equal(declined.state,'FAILED');assert.equal(declined.error.code,'RISINGWAVE_CHECKPOINT_NOT_RESUMABLE');
      await save({quietChangesRefusal:{id:declined.id,state:declined.state,error:declined.error}});
    }
    let firstRecord=await ensureCapture('first',{batchSize:1});
    if(!progress.firstInterruption){
      let cancelled;
      if(['CANCELLED','FAILED','INTERRUPTED'].includes(firstRecord.state)&&
          await optionalJson(join(directory,firstRecord.id+'-before-cancel.json')))cancelled=firstRecord;
      else cancelled=await waitForPartial(firstRecord.id,value=>value.state==='SNAPSHOT'&&value.rows>0&&value.snapshotComplete!==true);
      await save({firstInterruption:{id:cancelled.id,state:cancelled.state,progress:cancelled.progress}});
    }
    const firstCapture=await waitCapture(firstRecord.id,{resume:true,observe:async record=>{
      const p=record.progress;
      if(p?.state==='SNAPSHOT'&&p.cursor?.state?.snapshot===true)
        await touch('first-cursor-'+p.cursor.cursor,relation);
    }});
    assert.equal(firstCapture.manifest.rowCount,records.length);
    assert.equal(firstCapture.manifest.checkpoint.resumeAvailable,true);
    assert.ok(firstCapture.manifest.archives.length>0,'The interrupted initial snapshot remains in its attempt archive.');
    const firstObservation=await observeNativeEdition('first',firstCapture,relation);
    await save({firstCapture:shortCapture(firstCapture),firstChecks:await verifyRows(firstCapture,records,firstObservation),firstEvents:await eventSummary(firstCapture)});
    await event('resumed-original-full',{id:firstRecord.id,rows:firstCapture.manifest.rowCount,archives:firstCapture.manifest.archives.length,
      checkpoint:firstCapture.manifest.checkpoint});
    publicationId=progress.publicationId;
    if(!publicationId){
      const matching=(await client.state()).publications.filter(row=>row.query==='documents'&&row.revision===state.revision&&row.path==='/documents');
      need(matching.length<=1,'NATIVE_PUBLICATION_SELECTION_AMBIGUOUS');
      publicationId=matching[0]?.id??(await client.createPublication({expectedRevision:state.revision,query:'documents',path:'/documents'})).id;
      await save({publicationId});
    }
    const first=await extract('first');assert.equal(first.capture.manifest.rowCount,records.length);
    const initial=await publish(first,true);await save({firstPublication:initial.data.publication});
    await client.seller(publicationId,true);
    if(!progress.secondMutation){
      const selected=await setRows('visible-key-swap-and-membership',relation,[
        {storageId:'1',public_key:records[1].publicKey},{storageId:'2',public_key:records[0].publicKey},
        {storageId:'3',included:false},{storageId:'4',priority:5}]);
      const removed=await removeAndReturn();
      await save({secondMutation:{selection:selected,deleteInsert:removed}});
    }
    let secondRecord=await ensureCapture('second',{mode:'changes',baseCaptureId:firstRecord.id,batchSize:1});
    if(!progress.secondInterruption){
      let cancelled;
      if(['CANCELLED','FAILED','INTERRUPTED'].includes(secondRecord.state)&&
          await optionalJson(join(directory,secondRecord.id+'-before-cancel.json')))cancelled=secondRecord;
      else cancelled=await waitForPartial(secondRecord.id,value=>value.snapshotComplete===true&&value.pendingDeltas>0);
      await save({secondInterruption:{id:cancelled.id,state:cancelled.state,progress:cancelled.progress}});
    }
    const secondCapture=await waitCapture(secondRecord.id,{resume:true});
    assert.equal(secondCapture.manifest.effectiveMode,'changes');
    assert.equal(secondCapture.manifest.sourceRowCount,records.length);
    assert.equal(secondCapture.manifest.rowCount,records.length-1);
    assert.ok(secondCapture.manifest.events.replayed>0);
    const changes=await eventSummary(secondCapture);
    for(const op of ['Insert','Delete','UpdateDelete','UpdateInsert'])assert.ok(changes.operations[op]>0,'Native event not observed: '+op);
    const secondObservation=await observeNativeEdition('second',secondCapture,relation,{swapped:true});
    await save({secondCapture:shortCapture(secondCapture),secondChecks:await verifyRows(secondCapture,records,secondObservation),secondEvents:changes});
    const comparisonId=progress.comparisonId??'comparison-native-'+randomUUID();
    if(!progress.comparisonId)await save({comparisonId});
    const comparison=await client.compareCaptures({comparisonId,before:firstRecord.id,after:secondRecord.id,keys:['public_key'],sampleLimit:100});
    assert.equal(comparison.complete,true);assert.equal(comparison.counts.before,records.length);assert.equal(comparison.counts.after,records.length-1);
    assert.equal(comparison.counts.removed,1);assert.equal(comparison.counts.added,0);assert.ok(comparison.counts.changed>=3);
    const receivedComparison=await client.receiveComparison({comparisonId,directory:join(directory,'received-comparison')});
    assert.equal(receivedComparison.receiving.state,'COMPLETE');
    assert.deepEqual(receivedComparison.comparison.counts,comparison.counts);
    const received=[];
    for(const [label,record]of [['first',firstRecord],['second',secondRecord]]){
      const transferred=await client.receiveCapture({captureId:record.id,directory:join(directory,'received-'+label)});
      assert.equal(transferred.receiving.state,'COMPLETE');assert.equal(Object.keys(transferred.receiving.files).length,7);
      received.push({captureId:record.id,directory:transferred.directory,files:transferred.receiving.files,rowCount:transferred.capture.rowCount});
    }
    await save({comparison,comparisonReceiving:{directory:receivedComparison.directory,receiving:receivedComparison.receiving},receiving:received});
    const second=await extract('second');assert.equal(second.capture.manifest.rowCount,records.length-1);
    const latest=await publish(second);await save({secondPublication:latest.data.publication});

    assert.equal(first.capture.manifest.orderedRowsSha256,firstCapture.manifest.orderedRowsSha256,
      'The first published rows must equal the original complete workbench edition.');
    assert.equal(second.capture.manifest.orderedRowsSha256,secondCapture.manifest.orderedRowsSha256,
      'The second published rows must equal the original complete workbench edition.');
    {
      // Always reconcile the original delivery journal, including a crash after
      // saving paid progress but before marking the same operation COMPLETE.
      const operationFile=join(directory,'buyer-operation.json'),deliveryFile=join(directory,'buyer-delivery.json');
      const intentId=progress.buyerIntentId??'risingwave-native-'+randomUUID();await save({buyerIntentId:intentId});
      const request={publicationId,runId:initial.id,snapshot:first.candidate.dataset.snapshot,intentId,query:'limit=20',acceptIndex:0};
      const requestHash=identity(request);
      let operation=await optionalJson(operationFile),delivery=await optionalJson(deliveryFile);
      if(operation){
        assert.equal(operation.schema,'native.risingwave-buyer-operation.v1');
        assert.equal(operation.requestHash,requestHash,'The original buyer request changed.');
        assert.deepEqual(operation.request,request);
        assert.equal(operation.preparedSha256,hash(bytes(operation.prepared)));
        assert.equal(operation.offerSha256,operation.prepared.offerSha256);
        assert.equal(operation.prepared.intentId??intentId,intentId);
        assert.equal(operation.prepared.snapshot,request.snapshot);
      }
      need(!progress.paid||delivery,'NATIVE_BUYER_DELIVERY_MISSING','Restore the retained original delivery; do not resend a completed paid stage.');
      if(delivery){
        need(operation,'NATIVE_BUYER_OPERATION_MISSING');
        if(operation.state==='COMPLETE')assert.equal(operation.deliverySha256,hash(bytes(delivery)),'The original completed delivery changed.');
        assert.equal(delivery.schema,'native.risingwave-buyer-delivery.v1');
        assert.equal(delivery.requestHash,requestHash);
        assert.equal(delivery.preparedSha256,operation.preparedSha256);
        assert.equal(delivery.pageSha256,hash(bytes(delivery.page)));
        assert.equal(delivery.paid.snapshot,request.snapshot);
        assert.equal(delivery.paid.intentId,intentId);
        assert.equal(delivery.paid.buyerRequestId,operation.prepared.id);
        assert.equal(delivery.paid.status,'DELIVERED_REPORTED_SETTLED');
        assert.equal(delivery.paid.requests,2);assert.equal(delivery.paid.verifies,1);assert.equal(delivery.paid.settlements,1);
      }else{
        need(!operation||operation.state==='PREPARED','NATIVE_BUYER_RECONCILIATION_REQUIRED',
          'The original buyer request was dispatched without a retained complete delivery. Reconcile that original buyer and seller request before continuing this case.');
        if(!operation){
          const offer=await client.buyerOffer(publicationId,initial.id,'limit=20');
          assert.equal(offer.accepts.length,2);assert.equal(offer.accepts[0].amount,paymentOptions[0].amount);
          assert.deepEqual(offer.accepts[0].extra,paymentOptions[0].extra);
          const prepared=await client.prepareBuyer(publicationId,{runId:initial.id,query:'limit=20',intentId,
            acceptIndex:0,offerSha256:offer.offerSha256});
          assert.equal(prepared.snapshot,request.snapshot);
          operation={schema:'native.risingwave-buyer-operation.v1',request,requestHash,state:'PREPARED',
            createdAt:new Date().toISOString(),prepared,preparedSha256:hash(bytes(prepared)),offer,offerSha256:offer.offerSha256};
          await atomic(operationFile,operation);
        }
        const sellerUrl=(await client.publication(publicationId)).seller.origin,prepared=operation.prepared;
        const before={requests:paidRequests,verifies,settlements};
        const buyer=new X402BuyerClient({fetchImpl:(url,options)=>{
          paidRequests++;const selected=new URL(url);return fetch(sellerUrl+selected.pathname+selected.search,options);
        }});
        operation={...operation,state:'DISPATCHING',dispatchedAt:new Date().toISOString()};
        await atomic(operationFile,operation);
        const delivered=await buyer.call({...prepared.config.operation,approve:async()=>true,
          sign:async({challenge,accepted})=>({x402Version:2,resource:challenge.resource,accepted,
            extensions:challenge.extensions,payload:{transaction:'DISPOSABLE_NATIVE_PAYMENT_ADAPTER'}})});
        assert.equal(delivered.status,'DELIVERED_REPORTED_SETTLED');
        const page=await delivered.response.json();
        const counts={requests:paidRequests-before.requests,verifies:verifies-before.verifies,settlements:settlements-before.settlements};
        assert.equal(counts.requests,2);assert.equal(counts.verifies,1);assert.equal(counts.settlements,1);
        const paid={status:delivered.status,...counts,rows:page.rows.length,totalRows:page.page.total,
          snapshot:request.snapshot,offerSha256:operation.offerSha256,accepts:operation.offer.accepts,
          buyerRequestId:prepared.id,intentId,
          execution:'Original x402 buyer and native seller with disposable local signing/facilitator adapters.'};
        delivery={schema:'native.risingwave-buyer-delivery.v1',requestHash,preparedSha256:operation.preparedSha256,
          completedAt:new Date().toISOString(),pageSha256:hash(bytes(page)),paid,page};
        // One complete artifact binds the actual delivery, its rows and this original dispatch.
        await atomic(deliveryFile,delivery);
      }
      const {page,paid}=delivery;assert.equal(page.page.total,records.length);assert.ok(page.rows.length>0);
      assert.equal(paid.rows,page.rows.length);assert.equal(paid.totalRows,page.page.total);
      const observed=observedNativeRows(firstObservation),original=new Map(records.map(row=>[row.storageId,row]));
      for(const row of page.rows)verifyObservedRow(row,observed.get(row.storage_id),original.get(row.storage_id));
      paid.preservation={null:true,emptyText:true,largeIntegerText:true,decimalText:true,timestampText:true,originalSourceText:true};
      await atomic(deliveryFile,delivery);
      await immutable(join(directory,'buyer-page.json'),page);
      await atomic(operationFile,{...operation,state:'COMPLETE',completedAt:delivery.completedAt,
        deliverySha256:hash(bytes(delivery))});
      await save({paid});
      await event('original-retained-edition-buyer',paid);
    }
    let schedule=await command('schedule/status');
    if(!schedule.policyId){
      const target=(await client.publication(publicationId)).target;
      schedule=await command('schedule/save',{revision:schedule.revision,referenceRun:latest.id,planDigest:second.plan.data.digest,
        expectedSnapshot:target.versions.current,expectedRevision:target.versions.revision,intervalSeconds:86400,
        minimumRows:0,maximumRows:records.length+16,maximumDropPercent:null,onError:'pause',
        reviewer:'Commons native operator',note:'Preserve the original reviewed schema and source documents; retain each complete native subscription edition.'});
    }
    if(!schedule.enabled){
      const target=(await client.publication(publicationId)).target;
      schedule=await command('schedule/enable',{revision:schedule.revision,expectedSnapshot:target.versions.current,
        expectedRevision:target.versions.revision});
    }
    if(!progress.scheduled){
      const requestId=progress.scheduleRequestId??randomUUID();await save({scheduleRequestId:requestId});
      const refreshed=await command('schedule/run',{revision:schedule.revision,requestId});
      assert.equal(refreshed.state,'UNCHANGED',JSON.stringify(refreshed.data));
      await save({scheduled:refreshed});
    }
    schedule=await command('schedule/status');assert.equal(schedule.enabled,true);
    assert.equal(schedule.expected.snapshot,second.candidate.dataset.snapshot);
    await save({schedule});
    if(!progress.retention){
      source=(await openRisingWaveSourceFile(sourceFile,{env:environment})).source;
      const home=join(directory,'retention');await privateDirectory(home,true);
      const baseDir=join(home,'first'),gapDir=join(home,'expired'),rebuiltDir=join(home,'rebuilt');
      const small={...extraction,maxRows:32,maxBytes:16777216,batchSize:1,maxDurationMs:120000};
      const baseline=await source.capture('retention',captureInput,{...small,directory:baseDir,mode:'full',onGap:'error',
        onProgress:async value=>{
          if(value.state==='SNAPSHOT'&&value.cursor?.state?.snapshot===true)
            await touch('retention-cursor-'+value.cursor.cursor,retentionRelation);
        }});
      assert.equal(baseline.manifest.rowCount,8);assert.equal(baseline.manifest.checkpoint.resumeAvailable,true);
      const baselineObservation=await observeNativeEdition('retention-first',baseline,retentionRelation,{selected:records.slice(0,8)});
      const baselineChecks=await verifyRows(baseline,records.slice(0,8),baselineObservation);
      const cutoff=BigInt(baseline.manifest.checkpoint.lastTimestamp)+32000n,deadline=Date.now()+120000;
      for(;;){
        const current=rowsAsObjects(await sql('SELECT now() AS native_time',[],'retention-native-clock',{retainRows:true}))[0].native_time;
        const milliseconds=Date.parse(current);need(Number.isFinite(milliseconds),'NATIVE_CLOCK_INVALID');
        if(BigInt(milliseconds)>cutoff)break;
        need(Date.now()<deadline,'NATIVE_RETENTION_WINDOW_DID_NOT_ELAPSE');
        await event('retention-boundary-wait',{nativeTime:current,requiredAfterUnixMs:String(cutoff)});await delay(2000);
      }
      let gap;
      try{await source.capture('retention',captureInput,{...small,directory:gapDir,baseCaptureDirectory:baseDir,mode:'changes',onGap:'error'});}
      catch(issue){gap=errorValue(issue);}
      assert.equal(gap?.code,'RISINGWAVE_RETENTION_GAP','Retain the actual native retention-expired response.');
      await immutable(join(home,'gap-response.json'),gap);
      const rebuilt=await source.capture('retention',captureInput,{...small,directory:rebuiltDir,
        baseCaptureDirectory:baseDir,mode:'changes',onGap:'rebuild'});
      assert.equal(rebuilt.manifest.effectiveMode,'full');assert.equal(rebuilt.manifest.rowCount,8);
      assert.equal(rebuilt.manifest.gap.error.code,'RISINGWAVE_RETENTION_GAP');
      assert.equal(rebuilt.manifest.baseCapture.manifestSha256,baseline.files.manifest.sha256);
      const preserved=await readRisingWaveCapture(baseDir);assert.equal(preserved.files.manifest.sha256,baseline.files.manifest.sha256);
      const rebuiltObservation=await observeNativeEdition('retention-rebuilt',rebuilt,retentionRelation,{selected:records.slice(0,8)});
      const rebuiltChecks=await verifyRows(rebuilt,records.slice(0,8),rebuiltObservation);
      await save({retention:{first:shortCapture(baseline),firstChecks:baselineChecks,gap:{directory:gapDir,error:gap},
        rebuilt:shortCapture(rebuilt),rebuiltChecks,priorEditionPreserved:true}});
      await source.close();source=null;
      await event('native-retention-rebuild',{prior:baseline.manifest.id,rebuilt:rebuilt.manifest.id,gap:gap.code});
    }
    if(!progress.mcp){
      const {RISINGWAVE_TOOLS}=await import('../workspace/tools.mjs');
      mcp=await startMcpProcess({modulePath:fileURLToPath(new URL('../workspace/mcp.mjs',import.meta.url)),
        url:session.url,environment,directory,label:'native'});
      const initialized=await mcp.request('initialize',{protocolVersion:MCP_VERSION,capabilities:{},
        clientInfo:{name:'RisingWave original native operator',version:'1.0.0'}});
      assert.equal(initialized.protocolVersion,MCP_VERSION);mcp.notify('notifications/initialized');
      const catalogue=await mcp.request('tools/list'),names=catalogue.tools.map(tool=>tool.name);
      assert.deepEqual(names,RISINGWAVE_TOOLS.map(tool=>tool.name));assert.equal(new Set(names).size,names.length);
      const originalState=JSON.parse((await mcp.request('resources/read',{uri:'risingwave://workspace/status'})).contents[0].text);
      assert.equal(originalState.revision,state.revision);assert.ok(originalState.publications.some(row=>row.id===publicationId));
      const retained=JSON.parse((await mcp.request('resources/read',{uri:'risingwave://captures/'+firstRecord.id})).contents[0].text);
      assert.equal(retained.files.manifest.sha256,firstCapture.files.manifest.sha256);
      const closed=await mcp.close();mcp=null;assert.equal(closed.code,0);
      await save({mcp:{protocolVersion:MCP_VERSION,server:initialized.serverInfo,tools:names,
        sourceRevision:originalState.revision,captureId:firstRecord.id,manifestSha256:retained.files.manifest.sha256,process:closed}});
    }
    const current=await client.publication(publicationId);
    assert.equal(current.target.dataset.rowCount,records.length-1);
    const context={workspaceDirectory,sourceFile,merchantFile,sourceRevision:state.revision,publicationId,
      publisherDirectory:current.status.directory,targetDirectory:current.target.directory,
      firstRun:initial.id,secondRun:latest.id,firstCaptureId:firstRecord.id,secondCaptureId:secondRecord.id,
      comparisonId:progress.comparisonId,subscriptionRequestIds:[progress.documentsSubscriptionRequest,progress.retentionSubscriptionRequest],
      schedulePolicyId:progress.schedule.policyId,scheduleRevision:progress.schedule.revision,
      sourceInput:join(directory,'source-input.json'),inputSha256,connectionStringEnv,
      sameNativeSource:control.identity.endpoint,sellerRunningIntent:true};
    await save({context});
    await onOpen({session,client,context,progress:structuredClone(progress)});
    const closedState=await client.state();
    await session.close();session=null;await control.close();control=null;
    const modelUrl=new URL('../workspace/model.mjs',import.meta.url).href,nativeFactory=new URL('../../native-factory.mjs',import.meta.url).href;
    const reopenScript=[
      "const {openRisingWaveWorkbench}=await import(process.argv[1]);const {createNativeSellerServer}=await import(process.argv[2]);",
      "const facilitatorClient={async getSupported(){return{kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet'}],extensions:['bazaar'],signers:{}};},async verify(){throw new Error('Retained reopen does not request payment');},async settle(){throw new Error('Retained reopen does not settle payment');}};",
      "const m=await openRisingWaveWorkbench({directory:process.argv[3],datasetNativeFactory:compiled=>createNativeSellerServer(compiled,{facilitatorClient})});",
      "try{const state=await m.inspect();const publication=await m.inspectPublication(process.argv[4]);const first=await m.inspectRun(process.argv[4],process.argv[5]);const second=await m.inspectRun(process.argv[4],process.argv[6]);const schedule=await m.publicationCommand(process.argv[4],'schedule/status',{});const a=await m.captureRecord(process.argv[7]);const b=await m.captureRecord(process.argv[8]);console.log(JSON.stringify({revision:state.revision,publicationId:publication.id,sourceHash:a.sourceHash,currentSnapshot:publication.target.versions.current,sellerRunning:!!publication.seller?.origin,first:first.preview,second:second.preview,schedule,captures:[{id:a.id,files:a.files},{id:b.id,files:b.files}]}));}finally{await m.close();}"
    ].join('\n');
    const reopened=JSON.parse((await execute(process.execPath,['--input-type=module','-e',reopenScript,modelUrl,nativeFactory,workspaceDirectory,
      publicationId,initial.id,latest.id,firstRecord.id,secondRecord.id],{env:environment,timeout:60000,maxBuffer:16777216})).stdout);
    assert.equal(reopened.revision,closedState.revision);assert.equal(reopened.publicationId,publicationId);
    assert.equal(reopened.first.page.total,records.length);assert.equal(reopened.second.page.total,records.length-1);
    const originalRows=new Map(records.map(row=>[row.storageId,row]));
    for(const [page,observation]of [[reopened.first,firstObservation],[reopened.second,secondObservation]]){
      const observed=observedNativeRows(observation);
      for(const row of page.rows)verifyObservedRow(row,observed.get(row.storage_id),originalRows.get(row.storage_id));
    }
    assert.equal(reopened.sellerRunning,true);assert.equal(reopened.schedule.enabled,true);
    assert.equal(reopened.schedule.policyId,progress.schedule.policyId);
    assert.equal(reopened.currentSnapshot,second.candidate.dataset.snapshot);
    assert.equal(reopened.captures[0].files.manifest.sha256,firstCapture.files.manifest.sha256);
    await atomic(join(directory,'reopened.json'),reopened);
    result={schema:'native.risingwave-source-publisher-journey.v1',outcome:'PASS',startedAt:progress.startedAt,
      completedAt:new Date().toISOString(),attempt,sourcePin,protocolSourcePin:SOURCE_PIN,runtime:{node:process.version},
      case:requested,source:{path:sourceFile,sha256:hash(await readFile(sourceFile)),discovery:progress.discovery},
      context,quiet:progress.quiet,quietChecks:progress.quietChecks,quietChangesRefusal:progress.quietChangesRefusal,
      preview:{boundedFile:'preview.json',typedArrayFile:'typed-array-preview.json',typedArraySha256:hash(bytes(progress.typedArrayPreview))},
      first:{capture:progress.firstCapture,interruption:progress.firstInterruption,checks:progress.firstChecks,
        events:progress.firstEvents,plan:first.plan.id,run:initial.id,publication:initial.data.publication,publisherCapture:progress.firstPublicationCapture},
      second:{capture:progress.secondCapture,interruption:progress.secondInterruption,checks:progress.secondChecks,
        events:progress.secondEvents,plan:second.plan.id,run:latest.id,publication:latest.data.publication,publisherCapture:progress.secondPublicationCapture},
      comparison:progress.comparison,comparisonReceiving:progress.comparisonReceiving,receiving:progress.receiving,
      retention:progress.retention,paid:progress.paid,schedule:progress.schedule,scheduled:progress.scheduled,mcp:progress.mcp,
      reopen:{freshProcess:true,sourceRevision:reopened.revision,publicationId,firstRows:reopened.first.page.total,
        secondRows:reopened.second.page.total,sellerRunning:true,schedulePolicyId:reopened.schedule.policyId,
        scheduleRevision:reopened.schedule.revision,scheduleEnabled:true},
      paths:{directory,workspaceDirectory,sourceFile,merchantFile,sourceInput:join(directory,'source-input.json'),
        commands:join(directory,'native-commands.ndjson'),buyerPage:join(directory,'buyer-page.json')}};
  }catch(issue){
    failure=issue;result={schema:'native.risingwave-source-publisher-journey.v1',outcome:'FAILED',startedAt:progress.startedAt,
      stoppedAt:new Date().toISOString(),attempt,sourcePin,error:errorValue(issue),lastEvent:progress.lastEvent,context:progress.context??null};
  }finally{
    for(const owned of [mcp,source,session,control])if(owned){
      try{await owned.close();}catch(issue){failure??=issue;result={...result,outcome:'FAILED',cleanupError:errorValue(issue)};}
    }
    if(attemptRegistered&&result){
      await immutable(join(directory,'attempts',attempt+'.json'),result);
      await atomic(join(directory,'journey-result.json'),result);
    }
  }
  if(failure)throw failure;return result;
  }finally{await release();}
}

const HELP=[
 'RisingWave native receiving operation — Node 22.16+, pg, original x402 runtime',
 '',
 'node examples/native-demo.mjs --directory PRIVATE_CASE --input ORIGINAL.json',
 '  --input-sha SHA256 --source-url ORIGINAL_HTTPS_URL [--records-pointer /records]',
 '  [--connection-env RISINGWAVE_URL --tls require --ca-env CA_FILE_ENV]',
 '  [--allow-local --tls disable] [--initialize] [--source-pin COMMIT]',
 '',
 'Use an existing authorized RisingWave 3.1.0 server. --initialize creates only this',
 'case’s named schema/tables and sends the saved native subscription reviews.',
 'The empty records pointer selects an original top-level array. Otherwise select',
 'one top-level array field. Keep 64–10000 real original records and their byte hash.',
 'Reopen the same case path with the same source bytes and connection reference.',
 'The operator retains interrupted attempts, native commands, every complete edition,',
 'all comparison rows, the original publisher/schedule/buyer and fresh-process reopen.',
 'Payment adapters are disposable and local; native SQL, x402 HTTP and source files are real.',
].join('\n');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value={};
  try{
    if(args.length===1&&args[0]==='--help'){process.stdout.write(HELP+'\n');}
    else{
      const flags=new Set(['initialize','allow-local']),names=new Set(['directory','input','input-sha','source-url',
        'records-pointer','connection-env','tls','ca-env','source-pin',...flags]);
      for(let at=0;at<args.length;at++){
        const option=args[at];need(option.startsWith('--')&&names.has(option.slice(2)),'NATIVE_CLI_OPTION_INVALID',HELP);
        const name=option.slice(2);need(!Object.hasOwn(value,name),'NATIVE_CLI_DUPLICATE_OPTION');
        if(flags.has(name))value[name]=true;
        else{need(at+1<args.length&&!args[at+1].startsWith('--'),'NATIVE_CLI_VALUE_REQUIRED');value[name]=args[++at];}
      }
      runRisingWaveNativeJourney({directory:value.directory,inputFile:value.input,inputSha256:value['input-sha'],sourceUrl:value['source-url'],
        recordsPointer:value['records-pointer']??'/records',connectionStringEnv:value['connection-env']??'RISINGWAVE_URL',
        tls:value.tls??'require',allowLocal:value['allow-local']??false,caFileEnv:value['ca-env'],
        initialize:value.initialize??false,sourcePin:value['source-pin']??null,
        onEvent:entry=>process.stdout.write(JSON.stringify(entry)+'\n')})
        .then(result=>process.stdout.write(JSON.stringify({outcome:result.outcome,result:join(result.paths.directory,'journey-result.json'),
          workspace:result.context.workspaceDirectory,publicationId:result.context.publicationId,
          firstRows:result.first.capture.rowCount,secondRows:result.second.capture.rowCount})+'\n'))
        .catch(issue=>{process.stderr.write(JSON.stringify(errorValue(issue))+'\n');process.exitCode=1;});
    }
  }catch(issue){process.stderr.write(JSON.stringify(errorValue(issue))+'\n');process.exitCode=2;}
}
