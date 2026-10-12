// SPDX-License-Identifier: MIT
// Reuse the original private SF88 capture/inspection and native MCP source/file readers.
import {createHash} from 'node:crypto';
import {lstat,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {initializationDirectory as privateDirectory,initializationBytes as privateBytes,
  optionalInitializationBytes as optionalBytes,retainInitializationRecord as retainRecord,syncInitializationDirectory as syncDirectory}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {exportSelectedInbox,inspectSavedHandoff}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/operations-handoff/customer.mjs';
import {canonical,MAX_BYTES,MAX_JOBS}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/operations-handoff/contract.mjs';
import {need,InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {selectedNativeSourceInbox,nativeSourceFiles,checkNativeSourceFiles,createNativeSourceActions}
  from './native-analysis-sources.mjs';
import {createSavedFileReader} from './native-file.mjs';
import {nativeOperationsHandoffOperations,nativeOperationsHandoffActions}
  from './native-operations-handoff-schema.mjs';
export {nativeOperationsHandoffActions,nativeOperationsHandoffSchema} from './native-operations-handoff-schema.mjs';

const SCHEMA='stellar-forge.mcp-native-operations-handoff.v1';
const REQUEST=SCHEMA+'.request',RECEIPT=SCHEMA+'.receipt',ATTEMPT=SCHEMA+'.capture-attempt';
const ID=/^[A-Za-z0-9._:-]{1,128}$/,HASH=/^[a-f0-9]{64}$/,ALIAS=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_TOOL=262144,ROW_BUDGET=196608;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw new InputError(code);};
function fields(value,allowed){
  need(object(value)&&Object.keys(value).every(key=>allowed.includes(key)),'MCP_HANDOFF_ARGUMENTS_INVALID');
  return value;
}
function identifier(value){
  need(typeof value==='string'&&ID.test(value),'MCP_HANDOFF_STABLE_ID_REQUIRED');return value;
}
function expectedHash(value){
  need(typeof value==='string'&&HASH.test(value),'MCP_HANDOFF_SOURCE_SHA_REQUIRED');return value;
}
function stamp(value){
  return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
}
function absolute(value){
  need(typeof value==='string'&&resolve(value)===value&&value!=='/'&&!value.includes('\0'),
    'MCP_HANDOFF_PRIVATE_PATH_REQUIRED');return value;
}
function parse(raw){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{fail('MCP_HANDOFF_RETAINED_JSON_INVALID');}
}
function selection(body){
  identifier(body.id);
  need(body.inbox_alias===undefined||typeof body.inbox_alias==='string'&&ALIAS.test(body.inbox_alias),
    'MCP_HANDOFF_INBOX_ALIAS_INVALID');
  need(Array.isArray(body.intent_ids)&&body.intent_ids.length>0&&body.intent_ids.length<=MAX_JOBS&&
    new Set(body.intent_ids).size===body.intent_ids.length&&body.intent_ids.every(value=>typeof value==='string'&&ID.test(value)),
    'MCP_HANDOFF_ORIGINAL_INTENTS_REQUIRED');
  const maximum=body.max_verify_bytes??268435456;
  need(Number.isSafeInteger(maximum)&&maximum>=0&&maximum<=1073741824,'MCP_HANDOFF_VERIFICATION_LIMIT_INVALID');
  return {id:body.id,inbox_alias:body.inbox_alias??null,intent_ids:[...body.intent_ids],max_verify_bytes:maximum};
}
function page(body,total){
  const offset=body.offset??0,limit=body.limit??25;
  need(Number.isSafeInteger(offset)&&offset>=0&&offset<=total&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
    'MCP_HANDOFF_PAGE_INVALID');return {offset,limit};
}
function sameSelection(left,right){return canonical(left)===canonical(right);}
function sourceHeader(request){
  return request.source.inputs.find(input=>input.role==='inbox-manifest').sha256;
}
function receiptFor(request,report){
  need(report.source.inboxSha256===sourceHeader(request)&&
    sameSelection(report.rows.map(row=>row.intentId),request.selection.intent_ids),
    'MCP_HANDOFF_CAPTURE_SELECTION_CHANGED');
  return {schema:RECEIPT,id:request.id,requestSha256:request.requestSha256,
    source:report.source,reader:report.reader,counts:report.counts,
    intentIds:report.rows.map(row=>row.intentId),canReceive:report.rows.every(row=>row.canReceive),
    interpretation:report.interpretation,noExecution:true};
}
function validateReceipt(record,request){
  need(object(record)&&record.schema===RECEIPT&&record.id===request.id&&
    record.requestSha256===request.requestSha256&&object(record.source)&&HASH.test(record.source.sha256??'')&&
    Number.isSafeInteger(record.source.bytes)&&record.source.bytes>0&&record.source.bytes<=MAX_BYTES&&
    record.source.inboxSha256===sourceHeader(request)&&stamp(record.source.captureStartedAt)&&stamp(record.source.capturedAt)&&
    record.source.captureStartedAt<=record.source.capturedAt&&
    sameSelection(record.intentIds,request.selection.intent_ids)&&object(record.counts)&&
    record.counts.jobs===request.selection.intent_ids.length&&
    ['knownSignedAttempts','settled','verifiedRetainedOutputs','pendingOrUnknown'].every(key=>
      Number.isSafeInteger(record.counts[key])&&record.counts[key]>=0&&record.counts[key]<=record.counts.jobs)&&
    typeof record.canReceive==='boolean'&&record.noExecution===true,'MCP_HANDOFF_RECEIPT_CHANGED');
  return record;
}
function publicRequest(request){
  return {id:request.id,createdAt:request.createdAt,requestSha256:request.requestSha256,
    inbox_alias:request.selection.inbox_alias,intentIds:request.selection.intent_ids,
    maxVerifyBytes:request.selection.max_verify_bytes,inboxSha256:sourceHeader(request)};
}
function summary(request,receipt,recorded){
  return {...publicRequest(request),state:'SAVED',source:receipt.source,reader:receipt.reader,
    counts:receipt.counts,canReceive:receipt.canReceive,interpretation:receipt.interpretation,
    receiptRecorded:recorded,verifiedSavedFile:true,noExecution:true};
}
function rowFile(row){
  const bytes=encoded(row);return {bytes,sha256:sha(bytes)};
}
function bytesView(bytes,expected,body){
  expectedHash(expected);
  need(sha(bytes)===expected,'MCP_HANDOFF_ROW_CHANGED');
  const offset=body.byteOffset??0,maximum=body.maxBytes??32768;
  need(Number.isSafeInteger(offset)&&offset>=0&&offset<=bytes.length&&
    Number.isSafeInteger(maximum)&&maximum>=1&&maximum<=65536,'MCP_HANDOFF_BYTE_RANGE_INVALID');
  const selected=bytes.subarray(offset,Math.min(bytes.length,offset+maximum));
  return {contentType:'application/json',bytes:bytes.length,sha256:expected,
    byteOffset:offset,returnedBytes:selected.length,encoding:'base64',data:selected.toString('base64'),
    ...(offset===0&&selected.length===bytes.length?{text:selected.toString('utf8')}:{}),
    nextByteOffset:offset+selected.length<bytes.length?offset+selected.length:null};
}

/** The host has already opened this native workspace and grants only its registered original Inboxes. */
export function createNativeOperationsHandoff({manifest,currentWorkspace,runOwned,isClosed}={}){
  need(object(manifest)&&typeof currentWorkspace==='function'&&typeof runOwned==='function'&&typeof isClosed==='function',
    'MCP_HANDOFF_NATIVE_WORKSPACE_REQUIRED');
  const root=join(absolute(manifest.directory),'operations-handoffs');
  const reads=createSavedFileReader(),sources=createNativeSourceActions({manifest});
  const pending=new Set(),shutdown=new AbortController();
  let closed=false;
  function available(signal){
    need(!closed&&!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
    need(!signal?.aborted,'OPERATOR_ABORTED');
  }
  async function roots(create=false){
    await privateDirectory(manifest.directory);
    try{await privateDirectory(root,{create});return true;}
    catch(error){if(!create&&error.code==='ENOENT')return false;throw error;}
  }
  const folder=id=>join(root,sha(identifier(id)));
  async function retainedRequest(id,{optional=false}={}){
    const path=folder(id);
    try{await privateDirectory(root);await privateDirectory(path);}
    catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
    const raw=await optionalBytes(join(path,'request.json'),65536);
    if(raw===null){if(optional)return null;fail('MCP_HANDOFF_REQUEST_NOT_RETAINED');}
    const record=parse(raw);
    need(object(record)&&record.schema===REQUEST&&record.id===id&&record.selection?.id===id&&
      object(record.source)&&record.source.nativeWorkspace===manifest.directory&&
      typeof record.source.inboxDirectory==='string'&&stamp(record.createdAt)&&
      Array.isArray(record.source.inputs)&&record.source.inputs.length>=2&&record.source.inputs.length<=3&&
      record.source.inputs.every(input=>object(input)&&typeof input.role==='string'&&typeof input.path==='string'&&
        Number.isSafeInteger(input.bytes)&&input.bytes>0&&input.bytes<=65536&&HASH.test(input.sha256??''))&&
      new Set(record.source.inputs.map(input=>input.role)).size===record.source.inputs.length&&
      record.source.inputs.some(input=>input.role==='native-workspace')&&
      record.source.inputs.some(input=>input.role==='inbox-manifest')&&
      HASH.test(record.requestSha256??'')&&record.requestSha256===sha(canonical({
        selection:record.selection,source:record.source})),
      'MCP_HANDOFF_REQUEST_CHANGED');
    const normalized=selection({...record.selection,inbox_alias:record.selection.inbox_alias??undefined});
    need(sameSelection(normalized,record.selection),'MCP_HANDOFF_REQUEST_CHANGED');
    absolute(record.source.inboxDirectory);
    const expectedPaths={
      'native-workspace':join(manifest.directory,'native-workspace.json'),
      'inbox-manifest':join(record.source.inboxDirectory,'inbox.json'),
      ...(record.selection.inbox_alias===null?{}:{'inbox-registration':
        join(manifest.directory,'analysis-source-inboxes',record.selection.inbox_alias+'.json')})
    };
    need(record.source.inputs.length===Object.keys(expectedPaths).length&&record.source.inputs.every(input=>
      Object.hasOwn(expectedPaths,input.role)&&input.path===expectedPaths[input.role]),'MCP_HANDOFF_REQUEST_CHANGED');
    record.source.inputs.forEach(input=>absolute(input.path));
    return {path,record};
  }
  async function retainedAttempt(saved){
    const raw=await optionalBytes(join(saved.path,'capture-attempt.json'),4096);
    if(raw===null)return null;
    const record=parse(raw);
    need(object(record)&&record.schema===ATTEMPT&&record.id===saved.record.id&&
      record.requestSha256===saved.record.requestSha256&&stamp(record.startedAt)&&
      record.publication==='FIRST_CAPTURE_ONLY','MCP_HANDOFF_CAPTURE_ATTEMPT_CHANGED');
    return record;
  }
  async function beginCapture(saved,signal){
    available(signal);
    const attempt={schema:ATTEMPT,id:saved.record.id,requestSha256:saved.record.requestSha256,
      startedAt:new Date().toISOString(),publication:'FIRST_CAPTURE_ONLY'};
    try{await retainRecord(join(saved.path,'capture-attempt.json'),attempt);return true;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      await retainedAttempt(saved);return false;
    }
  }
  async function retainedReceipt(saved){
    const raw=await optionalBytes(join(saved.path,'receipt.json'),65536);
    return raw===null?null:validateReceipt(parse(raw),saved.record);
  }
  async function exists(path){
    try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
  }
  async function inspected(id,{signal,expected,publishReceipt=false}={}){
    available(signal);
    const saved=await retainedRequest(id),file=join(saved.path,'handoff.json');
    if(!await exists(file)){
      if(await retainedReceipt(saved)!==null)fail('MCP_HANDOFF_SAVED_FILE_UNAVAILABLE');
      if(await retainedAttempt(saved)!==null)fail('MCP_HANDOFF_CAPTURE_IN_PROGRESS_OR_UNAVAILABLE');
      fail('MCP_HANDOFF_NOT_YET_CAPTURED');
    }
    const read=await inspectSavedHandoff({file,signal});
    const candidate=receiptFor(saved.record,read.report);
    if(expected!==undefined)need(candidate.source.sha256===expectedHash(expected),'MCP_HANDOFF_SAVED_SOURCE_CHANGED');
    let receipt=await retainedReceipt(saved);
    if(receipt!==null)need(sameSelection(receipt,candidate),'MCP_HANDOFF_RECEIPT_CHANGED');
    if(publishReceipt&&receipt===null){
      available(signal);
      await retainRecord(join(saved.path,'receipt.json'),candidate,{resume:true});
      receipt=candidate;
    }
    return {saved,file,report:read.report,receipt:candidate,receiptRecorded:receipt!==null};
  }
  async function newRequest(selected,signal){
    await currentWorkspace();available(signal);
    const source=await selectedNativeSourceInbox(manifest,selected.inbox_alias);
    const inputs=await nativeSourceFiles([
      {role:'native-workspace',path:join(manifest.directory,'native-workspace.json'),maxBytes:65536},
      ...source.inputs
    ]);
    const authority={nativeWorkspace:manifest.directory,inboxDirectory:source.queue.root,inputs};
    const candidate={schema:REQUEST,id:selected.id,selection:selected,source:authority,
      requestSha256:sha(canonical({selection:selected,source:authority})),createdAt:new Date().toISOString()};
    await roots(true);await syncDirectory(manifest.directory);
    const path=folder(selected.id);await privateDirectory(path,{create:true});await syncDirectory(root);
    try{await retainRecord(join(path,'request.json'),candidate);}
    catch(error){
      // A second caller can have published the same request while this one inspected its source.
      if(error.code!=='EEXIST')throw error;
      const prior=await retainedRequest(selected.id);
      need(prior.record.requestSha256===candidate.requestSha256,'MCP_HANDOFF_REQUEST_CONFLICT');
      return prior;
    }
    return {path,record:candidate};
  }
  async function exportHandoff(body,context){
    const selected=selection(body),kind='operations-handoff:'+sha(canonical(selected));
    return runOwned('operations-handoff:'+sha(selected.id),kind,context,async signal=>{
      available(signal);
      let saved=await retainedRequest(selected.id,{optional:true});
      if(saved!==null)need(sameSelection(saved.record.selection,selected),'MCP_HANDOFF_REQUEST_CONFLICT');
      if(saved&&await exists(join(saved.path,'handoff.json'))){
        // Reopen the first published capture before touching the current Inbox or alias.
        const original=await inspected(selected.id,{signal,publishReceipt:true});
        return {...summary(original.saved.record,original.receipt,original.receiptRecorded),replayed:true};
      }
      if(saved&&(await retainedReceipt(saved))!==null)fail('MCP_HANDOFF_SAVED_FILE_UNAVAILABLE');
      if(saved&&(await retainedAttempt(saved))!==null)fail('MCP_HANDOFF_CAPTURE_IN_PROGRESS_OR_UNAVAILABLE');
      saved??=await newRequest(selected,signal);
      await currentWorkspace();available(signal);
      const source=await selectedNativeSourceInbox(manifest,selected.inbox_alias);
      need(source.queue.root===saved.record.source.inboxDirectory,'MCP_HANDOFF_REGISTERED_SOURCE_CHANGED');
      const current=await nativeSourceFiles([
        {role:'native-workspace',path:join(manifest.directory,'native-workspace.json'),maxBytes:65536},
        ...source.inputs
      ]);
      need(sameSelection(current,saved.record.source.inputs),'MCP_HANDOFF_REGISTERED_SOURCE_CHANGED');
      await checkNativeSourceFiles(saved.record.source.inputs);available(signal);
      // This durable create-only boundary distinguishes a not-started request from an ambiguous capture.
      // Only its publishing caller may invoke capture; missing bytes after it never authorize recapture.
      if(!await beginCapture(saved,signal)){
        const original=await inspected(selected.id,{signal,publishReceipt:true});
        return {...summary(original.saved.record,original.receipt,original.receiptRecorded),replayed:true};
      }
      available(signal);
      let recovered=false;
      try{
        await exportSelectedInbox({directory:source.queue.root,intentIds:selected.intent_ids,
          destination:join(saved.path,'handoff.json'),maxVerifyBytes:selected.max_verify_bytes,signal});
      }catch(error){
        // Publication is create-only. An already-published original is inspected; no new timestamped edition replaces it.
        if(!['EEXIST','BUYER_HANDOFF_ALREADY_EXISTS_USE_INSPECT','BUYER_HANDOFF_DESTINATION_EXISTS'].includes(error.code))throw error;
        recovered=true;
      }
      await checkNativeSourceFiles(saved.record.source.inputs);available(signal);
      const original=await inspected(selected.id,{signal,publishReceipt:true});
      return {...summary(original.saved.record,original.receipt,original.receiptRecorded),replayed:recovered};
    });
  }
  async function list(body){
    if(!await roots()){const {offset}=page(body,0);return {items:[],offset,total:0,nextOffset:null};}
    const entries=(await readdir(root,{withFileTypes:true})).filter(entry=>HASH.test(entry.name))
      .sort((a,b)=>a.name.localeCompare(b.name));
    need(entries.length<=10000,'MCP_HANDOFF_HISTORY_LIMIT');
    const {offset,limit}=page(body,entries.length),items=[];
    let size=0;
    for(const entry of entries.slice(offset,offset+limit)){
      need(entry.isDirectory()&&!entry.isSymbolicLink(),'MCP_HANDOFF_HISTORY_PATH_CHANGED');
      const path=join(root,entry.name);await privateDirectory(path);
      const raw=await optionalBytes(join(path,'request.json'),65536);
      if(raw===null){const item={requestKey:entry.name,state:'REQUEST_NOT_PUBLISHED',verifiedSavedFile:false};
        items.push(item);size+=encoded(item).length;continue;}
      const id=parse(raw).id;need(sha(identifier(id))===entry.name,'MCP_HANDOFF_REQUEST_CHANGED');
      const saved=await retainedRequest(id),receipt=await retainedReceipt(saved),attempt=await retainedAttempt(saved),
        present=await exists(join(path,'handoff.json'));
      const item={...publicRequest(saved.record),state:present?(receipt?'SAVED':'SAVED_NEEDS_INSPECTION'):
        (receipt?'SAVED_FILE_UNAVAILABLE':attempt?'CAPTURE_IN_PROGRESS_OR_UNAVAILABLE':'PENDING_CAPTURE'),
        captureAttempt:attempt?{startedAt:attempt.startedAt}:null,source:receipt?.source??null,counts:receipt?.counts??null,
        receiptRecorded:receipt!==null,verifiedSavedFile:false,noExecution:true};
      const length=encoded(item).length;if(items.length&&size+length>ROW_BUDGET)break;
      items.push(item);size+=length;
    }
    return {items,offset,total:entries.length,nextOffset:offset+items.length<entries.length?offset+items.length:null};
  }
  async function file(body,signal){
    // A retained receipt was written only after original contract validation. The existing reader rechecks complete bytes.
    const saved=await retainedRequest(identifier(body.id));
    let receipt=await retainedReceipt(saved);
    if(receipt===null)receipt=(await inspected(body.id,{signal,expected:body.sha256})).receipt;
    need(receipt.source.sha256===expectedHash(body.sha256),'MCP_HANDOFF_SAVED_SOURCE_CHANGED');
    await privateDirectory(saved.path);available(signal);
    need(await exists(join(saved.path,'handoff.json')),'MCP_HANDOFF_SAVED_FILE_UNAVAILABLE');
    const value=await reads({destination:join(saved.path,'handoff.json'),sha256:receipt.source.sha256,
      bytes:receipt.source.bytes,contentType:'application/json'},body);
    available(signal);
    return {id:saved.record.id,requestSha256:saved.record.requestSha256,inbox_alias:saved.record.selection.inbox_alias,
      source:receipt.source,file:value,noExecution:true};
  }
  async function perform(args,context){
    fields(args,['action','operationsHandoffOperation','operationsHandoffRequest']);
    need(args.action==='operations-handoff','MCP_HANDOFF_ACTION_REQUIRED');
    const operation=args.operationsHandoffOperation,body=args.operationsHandoffRequest===undefined?{}:args.operationsHandoffRequest;
    need(Object.hasOwn(nativeOperationsHandoffOperations,operation),'MCP_HANDOFF_OPERATION_REQUIRED');
    const spec=nativeOperationsHandoffOperations[operation];fields(body,Object.keys(spec.properties));
    need(spec.required.every(key=>Object.hasOwn(body,key)),'MCP_HANDOFF_OPERATION_FIELDS_REQUIRED');
    available(context.signal);
    const result=value=>{
      const output={schema:SCHEMA,operation,value};
      need(encoded(output).length<=MAX_TOOL,'MCP_HANDOFF_TOOL_PAGE_TOO_LARGE');return output;
    };
    if(operation==='inboxes'){
      await currentWorkspace();available(context.signal);
      return result({...(await sources.call({operation:'response-inboxes',body:{}})),ownInbox:true,noExecution:true});
    }
    if(operation==='jobs'){
      await currentWorkspace();available(context.signal);
      if(body.inbox_alias!==undefined)need(typeof body.inbox_alias==='string'&&ALIAS.test(body.inbox_alias),'MCP_HANDOFF_INBOX_ALIAS_INVALID');
      return result({...(await sources.call({operation:'saved-responses',body})),noExecution:true});
    }
    if(operation==='list')return result(await list(body));
    if(operation==='export')return result(await exportHandoff(body,context));
    identifier(body.id);
    if(operation==='read')return result(await file(body,context.signal));
    const original=await inspected(body.id,{signal:context.signal,expected:body.sha256});
    if(operation==='inspect')return result(summary(original.saved.record,original.receipt,original.receiptRecorded));
    expectedHash(body.sha256);
    if(operation==='row'){
      need(Number.isSafeInteger(body.row_index)&&body.row_index>=0&&body.row_index<original.report.rows.length,
        'MCP_HANDOFF_ROW_INDEX_INVALID');
      const row=original.report.rows[body.row_index],bytes=encoded(row);
      return result({id:body.id,source:original.receipt.source,index:body.row_index,intentId:row.intentId,
        file:bytesView(bytes,body.row_sha256,body),interpretation:original.report.interpretation,noExecution:true});
    }
    const all=original.report.rows,{offset,limit}=page(body,all.length),items=[];
    let size=0;
    for(let index=offset;index<all.length&&items.length<limit;index++){
      const row=all[index],file=rowFile(row);
      const item=file.bytes.length>ROW_BUDGET?{index,intentId:row.intentId,jobId:row.jobId,
        sourceRecordSha256:row.sourceRecordSha256,largeRow:{bytes:file.bytes.length,sha256:file.sha256,operation:'row'}}:
        {index,row, rowJson:{bytes:file.bytes.length,sha256:file.sha256}};
      const length=encoded(item).length;
      if(items.length&&size+length>ROW_BUDGET)break;
      items.push(item);size+=length;
    }
    return result({id:body.id,source:original.receipt.source,items,offset,total:all.length,
      nextOffset:offset+items.length<all.length?offset+items.length:null,interpretation:original.report.interpretation,noExecution:true});
  }
  return {
    async call(args={},context={}){
      need(object(context)&&(context.signal===undefined||context.signal instanceof AbortSignal),'MCP_HANDOFF_CONTEXT_INVALID');
      const signal=AbortSignal.any([shutdown.signal,...(context.signal?[context.signal]:[])]);
      available(signal);
      const promise=Promise.resolve().then(()=>perform(args,{...context,signal}));pending.add(promise);
      try{return await promise;}finally{pending.delete(promise);}
    },
    async close(){if(closed)return;closed=true;shutdown.abort();await Promise.allSettled([...pending]);}
  };
}
