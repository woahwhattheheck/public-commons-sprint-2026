// MIT. Retained SAM.gov source observations using original SF88 atomic storage.
import { readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  privateDirectory, writeJson, readJson, writeBytes, readBytes, jsonBytes,
} from '../../sf88-operator-buyer-cli/node/store.mjs';
import { acquirePrivateDirectoryWriter } from '../operations/history.mjs';
import {
  SAM_SCHEMA, SAM_PACKET_SCHEMA, SAM_ENDPOINT, MAX_SOURCE_BYTES, MAX_PACKET_BYTES, MAX_RECORDS,
  SOURCE_BASIS, SamError, requireThat, plain, copy, canonical, sha, now, text, integer, identifier,
  instant, sourceJSON, endpoint, queryDefinition, queryIdentity, searchRequest, cleanSourceUrl,
  validateDescriptionUrl, safeHeaders, sourceBuffer, parseSearchPage, noticeRow, reviewDeadline, compareNotices,
} from './core.mjs';
import { createSamTransport } from './transport.mjs';
import {NOTICE_DOCUMENT_FORMAT,NOTICE_DOCUMENT_BASIS,noticeDocumentUrls,validateNoticeDocumentUrl,
  parseNoticeDocument,noticeDocumentRow,rebuildNotice,noticeSourceIds} from './notice-document.mjs';

const HASH = /^[a-f0-9]{64}$/;
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const COLLECTIONS = ['queries','captures','editions','sources','selections','reviews','changes','handoffs','publications'];
const newId = prefix => prefix + '_' + randomUUID();
const revisionFile = revision => String(revision).padStart(8,'0') + '.json';
const emptyState = () => ({schema:SAM_SCHEMA,id:null,revision:0,createdAt:null,updatedAt:null,
  queries:[],captures:[],editions:[],sources:[],selections:[],reviews:[],changes:[],handoffs:[],publications:[]});
const controlledError = error => ({
  code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code) ? error.code : 'SAM_OPERATION_FAILED',
  message: error instanceof SamError ? error.message : 'The original local operation could not complete.',
  status: Number.isInteger(error?.status) ? error.status : 500,
});
const safeFilename = value => text(value,'Filename',240).replace(/[\\/\x00-\x1f\x7f]/g,'_');
function validSourceAcquisition(source) {
  if(!['search_page','description','attachment','notice_record','notice_resources','notice_history'].includes(source.kind))return false;
  if(source.status==='received_file')return source.kind!=='search_page' && source.request===null &&
    plain(source.headers) && Object.keys(source.headers).length===0 &&
    Array.isArray(source.redirects) && source.redirects.length===0;
  return Number.isInteger(source.status) && source.status>=100 && source.status<=599 &&
    plain(source.request) && source.request.method==='GET' && typeof source.request.url==='string';
}
function validateState(value) {
  requireThat(plain(value) && value.schema === SAM_SCHEMA && typeof value.id === 'string' &&
    /^sam_[a-f0-9-]{36}$/.test(value.id) && Number.isSafeInteger(value.revision) && value.revision >= 1 &&
    COLLECTIONS.every(key=>Array.isArray(value[key])), 'WORKSPACE_STATE_INVALID');
  const ids = new Set();
  for (const key of COLLECTIONS) for (const record of value[key]) {
    requireThat(plain(record) && typeof record.id === 'string' && !ids.has(record.id),
      'WORKSPACE_RECORD_INVALID'); ids.add(record.id);
  }
  for (const source of value.sources)
    requireThat(HASH.test(source.sha256) && Number.isSafeInteger(source.bytes) &&
      source.bytes >= 0 && source.bytes <= MAX_SOURCE_BYTES && validSourceAcquisition(source), 'SOURCE_RECORD_INVALID');
  for (const edition of value.editions)
    requireThat(HASH.test(edition.objectSha256) && HASH.test(edition.sha256) &&
      Number.isSafeInteger(edition.rowCount) && edition.rowCount >= 0 &&
      typeof edition.complete === 'boolean', 'EDITION_RECORD_INVALID');
  for (const capture of value.captures) {
    requireThat(['queued','running','paused','failed','capacity','complete'].includes(capture.status),
      'CAPTURE_STATE_INVALID');
    queryDefinition(capture.definition); endpoint(capture.endpoint);
    requireThat(HASH.test(capture.manifestSha256),'CAPTURE_MANIFEST_INVALID');
  }
  for (const query of value.queries) queryDefinition(query.definition);
  for (const selection of value.selections) {
    requireThat(value.editions.some(row=>row.id===selection.editionId) &&
      Array.isArray(selection.noticeIds) && selection.noticeIds.every(x=>typeof x==='string') &&
      new Set(selection.noticeIds).size===selection.noticeIds.length, 'SELECTION_RECORD_INVALID');
  }
  for (const handoff of value.handoffs) requireThat(
    Number.isSafeInteger(handoff.sourceRevision) && handoff.sourceRevision >= 1 &&
    handoff.sourceRevision < handoff.revision && handoff.revision <= value.revision &&
    HASH.test(handoff.sourceStateSha256), 'HANDOFF_RECORD_INVALID');
  return value;
}
function envelope(value, id, revision, previous) {
  requireThat(plain(value) && plain(value.state) && value.state.id === id &&
    value.state.revision === revision && value.state.previous === previous &&
    sha(value.state) === value.sha256, 'WORKSPACE_HISTORY_CHANGED');
  validateState(value.state); return value;
}
function historicalView(state, history) {
  const view = copy(state); delete view.previous; delete view.change;
  view.history = history.map(record=>({revision:record.state.revision,at:record.state.updatedAt,
    operator:record.state.change.operator,action:record.state.change.action,
    requestId:record.state.change.requestId,sha256:record.sha256}));
  view.summary = {queries:state.queries.length,captures:state.captures.length,editions:state.editions.length,
    notices:state.editions.reduce((sum,row)=>sum+row.rowCount,0),sources:state.sources.length,
    selections:state.selections.length,reviews:state.reviews.length,changes:state.changes.length,
    handoffs:state.handoffs.length,publications:state.publications.length};
  return view;
}
function requestIdentity(action,payload) {
  const body = copy(payload); delete body.expectedRevision;
  return sha({action,payload:body});
}
function uniqueStrings(values,name,maximum=MAX_RECORDS) {
  requireThat(Array.isArray(values) && values.length<=maximum &&
    values.every(value=>typeof value==='string' && value.length>0 && value.length<=12000) &&
    new Set(values).size===values.length, 'LIST_INVALID', name + ' must contain unique values.');
  return [...values];
}
function compareRequest(actual, expected) {
  requireThat(plain(actual) && actual.method === 'GET', 'SOURCE_REQUEST_INVALID');
  const a = new URL(cleanSourceUrl(actual.url)), b = new URL(expected.url);
  requireThat(a.origin===b.origin && a.pathname===b.pathname &&
    canonical([...a.searchParams.entries()].sort())===canonical([...b.searchParams.entries()].sort()),
    'SOURCE_REQUEST_CHANGED', 'The retained request differs from the original selected query and page index.');
}
function requiredReferences(states) {
  const hashes = new Set();
  for (const state of states) {
    for (const source of state.sources) hashes.add(source.sha256);
    for (const edition of state.editions) hashes.add(edition.objectSha256);
    for (const capture of state.captures) hashes.add(capture.manifestSha256);
    for (const publication of state.publications)
      for (const file of publication.files ?? []) hashes.add(file.sha256);
  }
  return [...hashes].sort();
}

export async function openSamWorkspace({
  directory, operator = 'SAM opportunity operator', apiKeyEnv = 'SAM_GOV_API_KEY',
  endpoint: selectedEndpoint = SAM_ENDPOINT, environment = process.env, fetchImpl,
  readOnly = false, opportunityDirectory, timeoutMs = 60000, maxSourceBytes = MAX_SOURCE_BYTES,
} = {}) {
  text(directory,'Workspace directory',4000); text(operator,'Operator',240);
  selectedEndpoint = endpoint(selectedEndpoint);
  requireThat(typeof readOnly==='boolean','READ_ONLY_INVALID');
  directory = await privateDirectory(resolve(directory),{create:!readOnly});
  const objectsDirectory = await privateDirectory(join(directory,'objects'),{create:!readOnly});
  const revisionsDirectory = await privateDirectory(join(directory,'revisions'),{create:!readOnly});
  const runsDirectory = await privateDirectory(join(directory,'runs'),{create:!readOnly});
  const lease = readOnly ? null : await acquirePrivateDirectoryWriter(directory);
  let transport;
  try{transport=createSamTransport({apiKeyEnv,endpoint:selectedEndpoint,environment,fetchImpl,timeoutMs,maxBytes:maxSourceBytes});}
  catch(error){await lease?.release();throw error;}
  let closed = false, closing = false, receiving = false, tail = Promise.resolve(), cache = null;
  const active = new Map();
  const ensure = (writing=false) => {
    requireThat(!closed && !closing,'WORKSPACE_CLOSED','The workspace is closing or closed.',409);
    requireThat(!writing || !readOnly,'WORKSPACE_READ_ONLY','Open the original workspace writer to change it.',409);
  };
  async function allHistory({fresh=false}={}) {
    if(cache && !readOnly && !fresh)return cache;
    const names=(await readdir(revisionsDirectory)).filter(name=>/^\d{8}\.json$/.test(name)).sort();
    requireThat(names.length<=50000,'WORKSPACE_HISTORY_CAPACITY');
    const history=[];let id=null,previous=null;
    for(let index=0;index<names.length;index++){
      requireThat(names[index]===revisionFile(index+1),'WORKSPACE_HISTORY_INCOMPLETE');
      const record=await readJson(join(revisionsDirectory,names[index]),MAX_STATE_BYTES);
      if(index===0)id=record.state?.id;
      envelope(record,id,index+1,previous);history.push(record);previous=record.sha256;
    }
    if(!readOnly)cache=history;return history;
  }
  async function current(){return (await allHistory()).at(-1)?.state ?? emptyState();}
  async function putObject(bytes) {
    requireThat(Buffer.isBuffer(bytes) && bytes.length <= MAX_PACKET_BYTES,'OBJECT_TOO_LARGE');
    const digest=sha(bytes),path=join(objectsDirectory,digest);
    try{await writeBytes(path,bytes,{exclusive:true});}
    catch(error){if(error.code!=='EEXIST')throw error;
      const retained=await readBytes(path,MAX_PACKET_BYTES);
      requireThat(sha(retained)===digest && retained.equals(bytes),'IMMUTABLE_OBJECT_CHANGED');}
    return digest;
  }
  async function objectBytes(digest,maximum=MAX_PACKET_BYTES){
    requireThat(HASH.test(digest),'OBJECT_ID_INVALID');
    const body=await readBytes(join(objectsDirectory,digest),maximum);
    requireThat(sha(body)===digest,'IMMUTABLE_OBJECT_CHANGED');return body;
  }
  async function objectJson(digest){return JSON.parse((await objectBytes(digest)).toString('utf8'));}
  function serialize(fn){
    const promise=tail.then(fn);tail=promise.catch(()=>{});return promise;
  }
  async function commit(action,payload,fn,{internal=false}={}){
    if(!internal){ensure(true);text(payload.requestId,'Request ID',200);}
    return serialize(async()=>{
      const history=await allHistory(),before=history.at(-1)?.state ?? emptyState();
      const requestId=payload.requestId ?? null,requestSha256=requestId?requestIdentity(action,payload):null;
      if(requestId){
        text(requestId,'Request ID',200);
        const prior=history.find(row=>row.state.change.requestId===requestId);
        if(prior){
          requireThat(prior.state.change.requestSha256===requestSha256,'REQUEST_ID_CONFLICT',
            'This request ID belongs to a different action.',409);
          return {workspace:await list({internal:true}),result:copy(prior.state.change.result),reused:true};
        }
      }
      if(!internal)integer(payload.expectedRevision,'Expected workspace revision',0,Number.MAX_SAFE_INTEGER);
      if(payload.expectedRevision!==undefined)requireThat(payload.expectedRevision===before.revision,
        'REVISION_CONFLICT','The workspace changed; reopen its current revision.',409,{revision:before.revision});
      const draft=copy(before),at=now();
      if(!draft.id){draft.id=newId('sam');draft.createdAt=at;}
      const result=await fn(draft,{history,before,at,nextRevision:before.revision+1});
      draft.revision=before.revision+1;draft.updatedAt=at;draft.previous=history.at(-1)?.sha256 ?? null;
      draft.change={action,operator,requestId,requestSha256,result:copy(result ?? null)};
      validateState(draft);
      const record={sha256:sha(draft),state:draft},body=jsonBytes(record);
      requireThat(body.length<=MAX_STATE_BYTES,'WORKSPACE_STATE_CAPACITY');
      await writeBytes(join(revisionsDirectory,revisionFile(draft.revision)),body,{exclusive:true});
      cache=[...history,record];
      return {workspace:await list({internal:true}),result:copy(result ?? null)};
    });
  }
  function record(state,collection,id){
    identifier(id);const found=state[collection].find(row=>row.id===id);
    requireThat(found,'RECORD_NOT_FOUND','The selected '+collection+' record was not found.',404);return found;
  }
  const runFile=id=>join(runsDirectory,identifier(id)+'.json');
  const resultFile=id=>join(runsDirectory,identifier(id)+'.result.json');
  async function writeProgress(progress){await writeJson(runFile(progress.captureId),progress);}
  async function readProgress(capture){
    try{
      const progress=await readJson(runFile(capture.id),MAX_STATE_BYTES);
      requireThat(progress.captureId===capture.id && progress.querySha256===capture.querySha256,
        'CAPTURE_PROGRESS_CHANGED');
      const localDigest=sha(jsonBytes(progress));
      if(localDigest!==capture.manifestSha256 && (await allHistory()).some(version=>
        version.state.captures.some(row=>row.id===capture.id && row.manifestSha256===localDigest))){
        // A received history can commit before its local progress projection.
        // Select the current frozen manifest instead of reopening an older cursor.
        return objectJson(capture.manifestSha256);
      }
      return progress;
    }catch(error){if(error.code!=='ENOENT')throw error;return objectJson(capture.manifestSha256);}
  }
  function captureSummary(capture,progress){
    return {...capture,status:progress.status,nextOffset:progress.nextOffset,count:progress.count,
      totalRecords:progress.totalRecords,pageCount:progress.pages.length,updatedAt:progress.updatedAt,
      completedAt:progress.completedAt ?? null,error:progress.error ?? null,
      startedAt:progress.startedAt ?? null,attemptCount:progress.attempts.length};
  }
  async function list({internal=false}={}){
    if(!internal)ensure();
    const history=await allHistory(),state=history.at(-1)?.state ?? emptyState();
    const view=historicalView(state,history);
    view.captures=await Promise.all(state.captures.map(async capture=>{
      if(['running','paused','failed','capacity'].includes(capture.status)){
        try{return captureSummary(capture,await readProgress(capture));}catch{return copy(capture);}
      }return copy(capture);
    }));
    view.capabilities={canCapture:!readOnly && transport.describe().keyConfigured,
      keyConfigured:transport.describe().keyConfigured,readOnly,activeCaptures:[...active.keys()],
      endpoint:selectedEndpoint,apiKeyEnv,opportunityConfigured:Boolean(opportunityDirectory)};
    return view;
  }
  async function editionData(editionId,state){
    state=state ?? await current();const entry=record(state,'editions',editionId);
    const body=await objectJson(entry.objectSha256);
    requireThat(body.schema==='stellar-forge.samgov-edition.v1' && body.id===entry.id &&
      Array.isArray(body.rows) && body.rows.length===entry.rowCount && sha(body.rows)===entry.sha256,
      'EDITION_CHANGED');
    return {record:copy(entry),rows:body.rows};
  }
  async function selectedRows(selectionId,state){
    state=state ?? await current();const selection=record(state,'selections',selectionId);
    const edition=await editionData(selection.editionId,state),wanted=new Set(selection.noticeIds);
    const rows=edition.rows.filter(row=>wanted.has(row.noticeId));
    requireThat(rows.length===wanted.size,'SELECTION_SOURCE_CHANGED');
    return {selection:copy(selection),edition:edition.record,rows};
  }
  async function notice(editionId,noticeId){
    identifier(noticeId,'Notice ID');const state=await current(),edition=await editionData(editionId,state);
    const row=edition.rows.find(item=>item.noticeId===noticeId);
    requireThat(row,'NOTICE_NOT_FOUND','Notice not found in the selected edition.',404);
    return {edition:edition.record,notice:copy(row),
      reviews:state.reviews.filter(item=>item.editionId===editionId && item.noticeId===noticeId).map(copy),
      changes:state.changes.filter(item=>item.noticeId===noticeId).map(copy)};
  }
  async function get(id,{offset=0,limit=50,search=''}={}){
    ensure();integer(offset,'Offset',0,MAX_RECORDS);integer(limit,'Page limit',1,1000);text(search,'Search',1000,true);
    const state=await current();
    let kind,entry;
    for(const name of ['queries','captures','editions','selections','handoffs','publications']){
      entry=state[name].find(row=>row.id===id);if(entry){kind=name==='queries'?'query':name.slice(0,-1);break;}
    }
    requireThat(entry,'RECORD_NOT_FOUND','Selected SAM record not found.',404);
    let items=[],extra={};
    if(kind==='capture'){
      const progress=await readProgress(entry);entry=captureSummary(entry,progress);
      items=progress.pages;extra={pages:copy(progress.pages),attempts:copy(progress.attempts),
        pending:copy(progress.pending),sourceBasis:SOURCE_BASIS};
    }else if(kind==='edition')items=(await editionData(id,state)).rows;
    else if(kind==='selection'){
      const selection=await selectedRows(id,state);items=selection.rows;extra.edition=selection.edition;
    }else if(kind==='query')items=state.captures.filter(row=>row.queryId===id);
    if(search){const term=search.toLocaleLowerCase();items=items.filter(row=>
      JSON.stringify(row).toLocaleLowerCase().includes(term));}
    return {kind,record:copy(entry),items:items.slice(offset,offset+limit).map(copy),total:items.length,offset,limit,...extra};
  }
  async function sourceRecord(sourceId,state){
    state=state ?? await current();
    let source=state.sources.find(item=>item.id===sourceId);
    if(!source)for(const capture of state.captures){
      if(!['running','paused','failed','capacity'].includes(capture.status))continue;
      const progress=await readProgress(capture);source=progress.sources.find(item=>item.id===sourceId);if(source)break;
    }
    requireThat(source,'SOURCE_NOT_FOUND','Retained source not found.',404);return source;
  }
  async function readSource(sourceId){
    ensure();identifier(sourceId,'Source ID');const source=await sourceRecord(sourceId);
    const body=await objectBytes(source.sha256,MAX_SOURCE_BYTES);
    requireThat(body.length===source.bytes,'SOURCE_BYTES_CHANGED');
    let contentText;
    if(/^(?:text\/|application\/(?:json|xml|.*\+json|.*\+xml))/.test(source.mediaType)){
      try{contentText=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{}
    }
    return {...copy(source),contentBase64:body.toString('base64'),...(contentText===undefined?{}:{contentText})};
  }
  async function retainedSource(receipt,{kind,filename:requestedFilename,noticeId}={}){
    requireThat(Buffer.isBuffer(receipt.body) && receipt.body.length<=MAX_SOURCE_BYTES,'SOURCE_INPUT_INVALID');
    receipt=transport.sanitizeReceipt(receipt);
    if(receipt.privateOriginalBody || receipt.privateOriginalHeaders){
      const privateRoot=await privateDirectory(join(directory,'private-source-originals'));
      const keep=async(name,bytes)=>{
        try{await writeBytes(join(privateRoot,name),bytes,{exclusive:true});}
        catch(error){if(error.code!=='EEXIST')throw error;
          requireThat((await readBytes(join(privateRoot,name),MAX_SOURCE_BYTES)).equals(bytes),'PRIVATE_ORIGINAL_CHANGED');}
      };
      if(receipt.privateOriginalBody)await keep(sha(receipt.privateOriginalBody),receipt.privateOriginalBody);
      if(receipt.privateOriginalHeaders){const bytes=jsonBytes(receipt.privateOriginalHeaders);await keep(sha(bytes)+'.headers.json',bytes);}
    }
    requireThat(validSourceAcquisition({...receipt,kind}),'SOURCE_RESPONSE_INVALID');
    const receivedFile=receipt.status==='received_file',
      capturedAt=instant(receipt.capturedAt,'Source capture time'),
      url=cleanSourceUrl(receivedFile?receipt.url:receipt.request.url);
    const mediaType=text(receipt.mediaType || 'application/octet-stream','Media type',500);
    requireThat(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;[^\r\n\x00]*)?$/i.test(mediaType),'SOURCE_MEDIA_TYPE_INVALID');
    const bodySha256=await putObject(receipt.body);
    const source={kind,url,filename:safeFilename(requestedFilename || receipt.filename || 'source.bin'),
      mediaType,
      bytes:receipt.body.length,sha256:bodySha256,capturedAt,status:receipt.status,
      request:receivedFile?null:{method:'GET',url},headers:safeHeaders(receipt.headers),
      originalSha256:receipt.originalSha256 || bodySha256,redactions:copy(receipt.redactions ?? []),
      representation:(receipt.redactions??[]).length?'credential_redacted':'original',
      originalPrivateAtCapture:Boolean(receipt.privateOriginalBody || receipt.privateOriginalHeaders),
      redirects:copy(receipt.redirects ?? []),...(noticeId?{noticeId}:{})};
    requireThat(HASH.test(source.originalSha256),'SOURCE_ORIGINAL_HASH_INVALID');
    return {id:'src_'+sha(source),...source};
  }
  function addSources(state,sources){
    for(const source of sources){
      const old=state.sources.find(row=>row.id===source.id);
      if(old)requireThat(canonical(old)===canonical(source),'IMMUTABLE_SOURCE_CHANGED');
      else state.sources.push(copy(source));
    }
  }
  async function retainEdition(state,{id=newId('edition'),name,kind='api_observation',captureId,
    parentEditionId=null,querySha256,complete,rows,sourceBasis=SOURCE_BASIS}){
    requireThat(rows.length<=MAX_RECORDS && new Set(rows.map(row=>row.noticeId)).size===rows.length,
      'DUPLICATE_NOTICE_IN_EDITION','Each selected API observation may contain a notice ID once.');
    const body={schema:'stellar-forge.samgov-edition.v1',id,rows};
    const objectSha256=await putObject(jsonBytes(body));
    const sourceIds=[...new Set(rows.flatMap(row=>noticeSourceIds(row)))];
    const entry={id,name:text(name,'Edition name',500),kind,captureId:captureId??null,parentEditionId,
      querySha256,complete:Boolean(complete),sourceBasis,rowCount:rows.length,sourceCount:sourceIds.length,
      sourceIds,sha256:sha(rows),objectSha256,createdAt:now()};
    state.editions.push(entry);return entry;
  }

  function freshProgress(captureId,definition,querySha256,selected,at){
    return {schema:'stellar-forge.samgov-capture-progress.v1',captureId,definition:copy(definition),
      querySha256,endpoint:selected,status:'queued',nextOffset:0,count:0,totalRecords:null,
      pages:[],sources:[],attempts:[],pending:null,startedAt:null,updatedAt:at,completedAt:null,error:null,retryAt:null};
  }
  function validateProgress(progress,capture){
    requireThat(plain(progress) && progress.schema==='stellar-forge.samgov-capture-progress.v1' &&
      progress.captureId===capture.id && progress.querySha256===capture.querySha256 &&
      progress.endpoint===capture.endpoint && queryIdentity(progress.definition,progress.endpoint)===capture.querySha256 &&
      progress.definition.pageSize===capture.definition.pageSize &&
      Array.isArray(progress.pages) && Array.isArray(progress.sources) && Array.isArray(progress.attempts) &&
      Number.isSafeInteger(progress.nextOffset) && progress.nextOffset===progress.pages.length &&
      progress.count===progress.pages.reduce((sum,page)=>sum+page.count,0) &&
      progress.count<=progress.definition.maxRecords,
      'CAPTURE_PROGRESS_CHANGED');
    const sourceIds=new Set(progress.sources.map(source=>source.id));
    requireThat(sourceIds.size===progress.sources.length &&
      progress.pages.every((page,index)=>page.offset===index && sourceIds.has(page.sourceId)),
      'CAPTURE_PAGE_CHAIN_CHANGED');
    return progress;
  }
  async function rowsForProgress(progress){
    const rows=[],seen=new Set();
    for(const page of progress.pages){
      const source=progress.sources.find(row=>row.id===page.sourceId);
      requireThat(source && source.status===200 && source.sha256===page.sha256,'CAPTURE_SOURCE_CHANGED');
      const expected=searchRequest(progress.definition,page.offset,progress.endpoint);
      compareRequest(source.request,expected);
      const parsed=parseSearchPage(await objectBytes(source.sha256,MAX_SOURCE_BYTES),expected);
      requireThat(parsed.rows.length===page.count && parsed.totalRecords===page.totalRecords &&
        parsed.totalRecords===progress.totalRecords,'CAPTURE_PAGE_CHANGED');
      for(let index=0;index<parsed.rows.length;index++){
        const row=noticeRow(parsed.rows[index],{sourceId:source.id,rowPointer:'/opportunitiesData/'+index,
          pageOffset:page.offset,sha256:source.sha256,capturedAt:source.capturedAt,url:source.url});
        requireThat(!seen.has(row.noticeId),'DUPLICATE_NOTICE_IN_CAPTURE',
          'The latest API pages repeat a notice ID; retain this observation and capture a fresh query.');
        seen.add(row.noticeId);rows.push(row);
      }
    }
    return rows;
  }
  function addProgressSource(progress,source){
    const old=progress.sources.find(row=>row.id===source.id);
    if(old)requireThat(canonical(old)===canonical(source),'IMMUTABLE_SOURCE_CHANGED');
    else progress.sources.push(copy(source));
  }
  async function retainedAttempt(progress,pending){
    try{
      const receipt=await readJson(resultFile(pending.id),MAX_STATE_BYTES);
      requireThat(receipt.schema==='stellar-forge.samgov-attempt-result.v1' &&
        receipt.captureId===progress.captureId && receipt.attemptId===pending.id &&
        receipt.offset===pending.offset && sha(receipt.source)===receipt.sourceSha256,
        'CAPTURE_ATTEMPT_CHANGED');
      compareRequest(receipt.source.request,searchRequest(progress.definition,pending.offset,progress.endpoint));
      const bytes=await objectBytes(receipt.source.sha256,MAX_SOURCE_BYTES);
      requireThat(bytes.length===receipt.source.bytes,'CAPTURE_SOURCE_CHANGED');
      return receipt;
    }catch(error){
      if(error.code!=='ENOENT')throw error;
      // Portable receiving carries the original response in the immutable
      // manifest/source objects, even when this host has no attempt sidecar.
      const attempt=progress.attempts.find(row=>row.id===pending.id),
        source=progress.sources.find(row=>row.id===attempt?.sourceId);
      if(!source)return null;
      requireThat(source.sha256===attempt.sha256 && source.status===attempt.responseStatus,
        'CAPTURE_ATTEMPT_CHANGED');
      return {schema:'stellar-forge.samgov-attempt-result.v1',captureId:progress.captureId,
        attemptId:pending.id,offset:pending.offset,source,sourceSha256:sha(source),retryAt:progress.retryAt??null};
    }
  }
  async function acceptAttempt(progress,receipt,seen){
    const source=receipt.source,pending=progress.pending;
    requireThat(pending && pending.id===receipt.attemptId && pending.offset===progress.nextOffset,
      'CAPTURE_ATTEMPT_CHANGED');
    addProgressSource(progress,source);
    const attempt=progress.attempts.find(row=>row.id===pending.id);
    requireThat(attempt,'CAPTURE_ATTEMPT_CHANGED');
    Object.assign(attempt,{status:'response_retained',sourceId:source.id,responseStatus:source.status,
      capturedAt:source.capturedAt,sha256:source.sha256});
    progress.retryAt=receipt.retryAt ?? null;
    if(source.status!==200){
      progress.pending=null;attempt.status='http_error';
      throw new SamError('SAM_HTTP_'+source.status,
        'SAM returned HTTP '+source.status+' for the retained page.',source.status===429?429:502,
        {sourceId:source.id,retryAt:progress.retryAt});
    }
    const expected=searchRequest(progress.definition,pending.offset,progress.endpoint);
    const parsed=parseSearchPage(await objectBytes(source.sha256,MAX_SOURCE_BYTES),expected);
    if(progress.totalRecords===null)progress.totalRecords=parsed.totalRecords;
    requireThat(progress.totalRecords===parsed.totalRecords,'SOURCE_TOTAL_CHANGED',
      'The query total changed between original API pages; this observation remains incomplete.',409);
    requireThat(progress.count+parsed.rows.length<=parsed.totalRecords,'SOURCE_TOTAL_CHANGED',
      'The retained pages contain more rows than the source total.',409);
    requireThat(parsed.rows.length===Math.min(parsed.limit,parsed.totalRecords-progress.count),
      'SOURCE_PAGE_INCOMPLETE','The original API page does not fill its declared part of the source total.',409);
    const incoming=parsed.rows.map((raw,index)=>noticeRow(raw,{sourceId:source.id,
      rowPointer:'/opportunitiesData/'+index,pageOffset:pending.offset,sha256:source.sha256,
      capturedAt:source.capturedAt,url:source.url}));
    const newIds=new Set();
    for(const row of incoming){
      requireThat(!seen.has(row.noticeId) && !newIds.has(row.noticeId),'DUPLICATE_NOTICE_IN_CAPTURE',
        'The latest API pages repeat a notice ID; this observation remains incomplete.',409);
      newIds.add(row.noticeId);
    }
    if(progress.count+incoming.length>progress.definition.maxRecords){
      progress.status='capacity';
      progress.error={code:'CAPTURE_RECORD_CAPACITY',message:'Increase the same capture capacity to accept its retained next page.',
        status:409,requiredRecords:progress.count+incoming.length};
      return false;
    }
    progress.pages.push({index:progress.pages.length,offset:parsed.offset,limit:parsed.limit,
      count:incoming.length,totalRecords:parsed.totalRecords,sourceId:source.id,sha256:source.sha256,
      capturedAt:source.capturedAt,status:source.status});
    for(const id of newIds)seen.add(id);
    progress.count+=incoming.length;progress.nextOffset+=1;progress.pending=null;
    progress.error=null;progress.retryAt=null;attempt.status='accepted';
    return true;
  }
  async function progressEvent(progress,onProgress){
    progress.updatedAt=now();await writeProgress(progress);
    if(onProgress)try{await onProgress({captureId:progress.captureId,status:progress.status,
      nextOffset:progress.nextOffset,count:progress.count,totalRecords:progress.totalRecords,
      pageCount:progress.pages.length,attemptCount:progress.attempts.length,
      pending:copy(progress.pending),error:copy(progress.error),retryAt:progress.retryAt,updatedAt:progress.updatedAt});}catch{}
  }
  async function finishCapture(progress,{action='capture_checkpoint'}={}){
    return commit(action,{},async(state)=>{
      const capture=record(state,'captures',progress.captureId);
      validateProgress(progress,capture);
      addSources(state,progress.sources);
      const rows=await rowsForProgress(progress);
      requireThat(rows.length===progress.count,'CAPTURE_COUNT_CHANGED');
      const complete=progress.totalRecords!==null && progress.count===progress.totalRecords &&
        progress.pending===null && progress.status==='complete';
      let editionId=capture.editionId ?? null;
      if(progress.pages.length || complete){
        const previous=editionId?record(state,'editions',editionId):null;
        if(!previous || previous.sha256!==sha(rows) || previous.complete!==complete){
          const edition=await retainEdition(state,{name:capture.name,kind:'api_observation',
            captureId:capture.id,parentEditionId:previous?.id ?? null,querySha256:capture.querySha256,
            complete,rows});
          editionId=edition.id;
        }
      }
      const manifestSha256=await putObject(jsonBytes(progress));
      Object.assign(capture,captureSummary(capture,progress),{manifestSha256,editionId,
        definition:copy(progress.definition)});
      return {captureId:capture.id,editionId,status:progress.status,complete,count:progress.count,
        totalRecords:progress.totalRecords,sourceBasis:SOURCE_BASIS};
    },{internal:true});
  }
  async function performCapture(captureId,{signal,onProgress,controller}){
    let progress;
    try{
      const started=await commit('capture_started',{},async(state)=>{
        const capture=record(state,'captures',captureId);
        requireThat(capture.endpoint===selectedEndpoint,'CAPTURE_ENDPOINT_CHANGED',
          'Open this capture with its original production or alpha endpoint.',409);
        requireThat(capture.status!=='complete','CAPTURE_ALREADY_COMPLETE',
          'Start a new observation to refresh a complete query.',409);
        progress=validateProgress(await readProgress(capture),capture);
        requireThat(!progress.retryAt || Date.parse(progress.retryAt)<=Date.now(),'SOURCE_RETRY_AFTER',
          'The original provider retry time has not arrived.',429,{retryAt:progress.retryAt});
        progress.definition=copy(capture.definition);progress.status='running';
        progress.startedAt=progress.startedAt ?? now();progress.updatedAt=now();progress.error=null;
        await writeProgress(progress);capture.status='running';capture.startedAt=progress.startedAt;
        capture.updatedAt=progress.updatedAt;capture.error=null;
        capture.manifestSha256=await putObject(jsonBytes(progress));
        return {captureId,status:'running'};
      },{internal:true});
      const seen=new Set((await rowsForProgress(progress)).map(row=>row.noticeId));
      await progressEvent(progress,onProgress);
      while(true){
        controller.signal.throwIfAborted();
        if(progress.pending){
          const saved=await retainedAttempt(progress,progress.pending);
          if(saved){
            const accepted=await acceptAttempt(progress,saved,seen);
            await progressEvent(progress,onProgress);
            if(!accepted)break;
          }else{
            const old=progress.attempts.find(row=>row.id===progress.pending.id);
            if(old){old.status='interrupted';old.endedAt=now();}
            progress.pending=null;await progressEvent(progress,onProgress);
          }
        }
        if(progress.totalRecords!==null && progress.count===progress.totalRecords){
          progress.status='complete';progress.completedAt=now();progress.error=null;break;
        }
        if(progress.count>=progress.definition.maxRecords){
          progress.status='capacity';progress.error={code:'CAPTURE_RECORD_CAPACITY',
            message:'The selected record capacity is reached; this observation is incomplete.',status:409};break;
        }
        const request=searchRequest(progress.definition,progress.nextOffset,progress.endpoint);
        const attempt={id:newId('attempt'),offset:progress.nextOffset,requestedAt:now(),
          request:{method:'GET',url:request.url},status:'pending'};
        progress.pending={id:attempt.id,offset:attempt.offset,request:copy(attempt.request),requestedAt:attempt.requestedAt};
        progress.attempts.push(attempt);await progressEvent(progress,onProgress);
        const fetched=await transport.fetchSource({url:request.url,kind:'search',signal:controller.signal,
          filename:'sam-page-'+String(request.offset).padStart(6,'0')+'.json'});
        const source=await retainedSource(fetched,{kind:'search_page'});
        const result={schema:'stellar-forge.samgov-attempt-result.v1',captureId,
          attemptId:attempt.id,offset:attempt.offset,source,sourceSha256:sha(source),retryAt:fetched.retryAt ?? null};
        await writeJson(resultFile(attempt.id),result,{exclusive:true});
        // The exact response is durable before it advances the original page cursor.
        const accepted=await acceptAttempt(progress,result,seen);
        await progressEvent(progress,onProgress);
        if(!accepted)break;
      }
    }catch(error){
      if(!progress)throw error;
      progress.status=controller.signal.aborted?'paused':'failed';
      progress.error=controlledError(error);
      if(error?.details?.retryAt)progress.retryAt=error.details.retryAt;
      const attempt=progress.pending && progress.attempts.find(row=>row.id===progress.pending.id);
      if(attempt && attempt.status==='pending')Object.assign(attempt,{status:controller.signal.aborted?'paused':'failed',
        error:controlledError(error),endedAt:now()});
    }finally{
      signal?.removeEventListener('abort',controller.externalAbort);
    }
    await progressEvent(progress,onProgress);
    return finishCapture(progress);
  }
  function runCapture(captureId,{signal,onProgress}={}){
    ensure(true);identifier(captureId,'Capture ID');
    requireThat(!receiving,'WORKSPACE_RECEIVING','The original portable workspace is being received.',409);
    requireThat(!active.has(captureId),'CAPTURE_ALREADY_RUNNING','This original capture already has an active owner.',409);
    requireThat(onProgress===undefined || typeof onProgress==='function','PROGRESS_HANDLER_INVALID');
    const controller=new AbortController();
    controller.externalAbort=()=>controller.abort(signal.reason);
    if(signal){if(signal.aborted)controller.externalAbort();else signal.addEventListener('abort',controller.externalAbort,{once:true});}
    const run={controller,promise:null};
    active.set(captureId,run);
    run.promise=performCapture(captureId,{signal,onProgress,controller}).finally(()=>active.delete(captureId));
    return run.promise;
  }
  function cancelCapture(captureId){
    ensure();identifier(captureId,'Capture ID');
    const run=active.get(captureId);
    if(run)run.controller.abort(new SamError('SOURCE_CANCELLED','The operator paused the original capture.',409));
    return {captureId,active:Boolean(run),pauseRequested:Boolean(run)};
  }
  async function compare(beforeEditionId,afterEditionId){
    ensure();const state=await current(),before=await editionData(beforeEditionId,state),
      after=await editionData(afterEditionId,state);
    return {before:before.record,after:after.record,sourceBasis:before.record.sourceBasis===after.record.sourceBasis?after.record.sourceBasis:'mixed_retained_sources',
      ...compareNotices(before.rows,after.rows)};
  }
  async function importedCapture(state,payload,{at}){
    const definition=queryDefinition(payload.definition);
    requireThat(Array.isArray(payload.pages) && payload.pages.length>0 && payload.pages.length<=MAX_RECORDS,
      'CAPTURE_PAGES_REQUIRED','Supply the original ordered API page responses.');
    const first=new URL(cleanSourceUrl(payload.pages[0]?.request?.url));
    const importedEndpoint=endpoint(first.origin+first.pathname);
    const querySha256=queryIdentity(definition,importedEndpoint),captureId=newId('capture'),queryId=newId('query');
    const name=text(payload.name,'Capture name',500),progress=freshProgress(captureId,definition,querySha256,importedEndpoint,at);
    progress.startedAt=at;progress.status='paused';
    const seen=new Set();
    for(let index=0;index<payload.pages.length;index++){
      const item=payload.pages[index],expected=searchRequest(definition,index,importedEndpoint);
      requireThat(plain(item),'CAPTURE_PAGE_INVALID');compareRequest(item.request,expected);
      requireThat(item.status===200,'CAPTURE_IMPORT_RESPONSE_REQUIRED',
        'A receiving capture needs each original successful page response; retain errors in the original capture journal.');
      const body=sourceBuffer(item);
      const source=await retainedSource({request:item.request,status:item.status,capturedAt:item.capturedAt,
        headers:item.headers??{},body,filename:'sam-imported-page-'+String(index).padStart(6,'0')+'.json',
        mediaType:safeHeaders(item.headers??{})['content-type'] ?? 'application/json'}, {kind:'search_page'});
      const attempt={id:newId('attempt'),offset:index,requestedAt:source.capturedAt,
        request:copy(source.request),status:'response_retained'};
      progress.attempts.push(attempt);progress.pending={id:attempt.id,offset:index,
        request:copy(source.request),requestedAt:source.capturedAt};
      requireThat(await acceptAttempt(progress,{attemptId:attempt.id,source,retryAt:null},seen),
        'CAPTURE_IMPORT_CAPACITY','Increase the declared capacity to retain all supplied source pages.');
    }
    progress.status=progress.count===progress.totalRecords?'complete':'paused';
    progress.completedAt=progress.status==='complete'?at:null;progress.updatedAt=at;
    const rows=await rowsForProgress(progress);
    addSources(state,progress.sources);
    const edition=await retainEdition(state,{name,captureId,querySha256,complete:progress.status==='complete',rows});
    state.queries.push({id:queryId,name,revision:1,definition,createdAt:at,updatedAt:at});
    const manifestSha256=await putObject(jsonBytes(progress));
    const capture=captureSummary({id:captureId,name,queryId,queryRevision:1,definition,
      endpoint:importedEndpoint,querySha256,editionId:edition.id,manifestSha256},progress);
    state.captures.push(capture);await writeProgress(progress);
    return {queryId,captureId,editionId:edition.id,status:progress.status,complete:progress.status==='complete'};
  }

  async function importedNotice(state,payload,{at}){
    requireThat(plain(payload.notice),'NOTICE_DOCUMENT_REQUIRED',
      'Receive the complete original SAM notice document.');
    const initial=parseNoticeDocument(sourceJSON(sourceBuffer(payload.notice))),id=initial.id,
      urls=noticeDocumentUrls(id),sources=[],parts={};
    const inputs=[['notice','notice_record'],['resources','notice_resources'],['history','notice_history']];
    for(const [field,kind] of inputs){
      const input=payload[field];if(input===undefined)continue;
      requireThat(plain(input),'NOTICE_DOCUMENT_INPUT_INVALID');
      const url=validateNoticeDocumentUrl(input.url??urls[field],kind,id);
      let receipt={url,request:null,status:'received_file',capturedAt:input.capturedAt??at,
        filename:input.filename??('sam-'+id+'-'+field+'.json'),mediaType:'application/json',
        body:sourceBuffer(input),headers:{},redirects:[]};
      if(input.response!==undefined){
        requireThat(plain(input.response),'SOURCE_RESPONSE_INVALID');
        compareRequest(input.response.request,{url});
        requireThat(input.response.status===200,'NOTICE_DOCUMENT_HTTP_RESPONSE_REQUIRED',
          'Receive the original successful notice response, or the retained file without an HTTP receipt.');
        receipt={...receipt,request:{method:'GET',url},status:input.response.status,
          headers:safeHeaders(input.response.headers??{})};
      }
      const source=await retainedSource(receipt,{kind,noticeId:id});sources.push(source);
      parts[field]=sourceJSON(await objectBytes(source.sha256,MAX_SOURCE_BYTES));
    }
    const original=sources[0],companions=sources.slice(1).map(source=>({
      kind:source.kind,sourceId:source.id,sha256:source.sha256,capturedAt:source.capturedAt,
      url:source.url,rowPointer:''}));
    const row=noticeDocumentRow(parts,{sourceId:original.id,sha256:original.sha256,
      capturedAt:original.capturedAt,url:original.url,rowPointer:'',pageOffset:null,
      format:NOTICE_DOCUMENT_FORMAT,companions},[]);
    const parent=payload.editionId?await editionData(payload.editionId,state):null;
    const previous=parent?.rows.find(item=>item.noticeId===id),available=selectedResources(row);
    if(previous)row.resources=previous.resources.filter(resource=>
      available.some(item=>item.kind===resource.kind && item.url===resource.url)).map(copy);
    const selected=rebuildNotice(row),rows=parent?parent.rows.filter(item=>item.noticeId!==id).concat([selected]):[selected];
    addSources(state,sources);
    const basis=rows.every(item=>item.source.format===NOTICE_DOCUMENT_FORMAT)?NOTICE_DOCUMENT_BASIS:'mixed_retained_sources';
    const edition=await retainEdition(state,{name:payload.name??row.title,kind:'notice_document_observation',
      parentEditionId:parent?.record.id??null,captureId:null,
      querySha256:sha({format:NOTICE_DOCUMENT_FORMAT,urls:sources.map(source=>source.url),
        parentEditionId:parent?.record.id??null}),sourceBasis:basis,
      complete:parent?parent.record.complete:true,rows});
    return {editionId:edition.id,parentEditionId:edition.parentEditionId,noticeId:id,
      sourceIds:sources.map(source=>source.id),sourceBasis:basis};
  }
  function selectedResources(row,{descriptions=true,attachments=true,resourceUrls}={}){
    requireThat(typeof descriptions==='boolean' && typeof attachments==='boolean','RESOURCE_SELECTION_INVALID');
    const candidates=[];
    if(descriptions && row.descriptionUrl)candidates.push({kind:'description',url:row.descriptionUrl});
    if(attachments)for(const url of row.resourceLinks)candidates.push({kind:'attachment',url});
    const unique=[...new Map(candidates.map(item=>[item.kind+'\n'+item.url,item])).values()];
    if(resourceUrls!==undefined){
      const selected=new Set(uniqueStrings(resourceUrls,'Resource URLs',10000));
      return unique.filter(item=>selected.has(item.url));
    }
    return unique;
  }
  function resourceRecord(source,kind,url){
    return {sourceId:source.id,kind,url,filename:source.filename,mediaType:source.mediaType,
      bytes:source.bytes,sha256:source.sha256,capturedAt:source.capturedAt,status:source.status,
      originalSha256:source.originalSha256,redactions:copy(source.redactions)};
  }
  async function resourceEdition(state,payload,{at},{signal}={}){
    const parent=await editionData(payload.editionId,state),wanted=new Set(uniqueStrings(payload.noticeIds,'Notice IDs'));
    requireThat(wanted.size>0 && parent.rows.filter(row=>wanted.has(row.noticeId)).length===wanted.size,
      'RESOURCE_NOTICES_REQUIRED','Select notice IDs from this original edition.');
    const tasks=parent.rows.filter(row=>wanted.has(row.noticeId)).flatMap(row=>
      selectedResources(row,payload).map(item=>({...item,noticeId:row.noticeId})));
    requireThat(tasks.length>0 && tasks.length<=10000,'RESOURCE_SELECTION_EMPTY',
      'Select at least one original notice resource, up to 10,000 per receiving operation.');
    if(payload.resourceUrls)for(const url of payload.resourceUrls)requireThat(tasks.some(task=>task.url===url),
      'RESOURCE_NOT_IN_NOTICE','The selected URL is absent from these original notices.');
    const operationId='resources_'+sha({workspaceId:state.id,requestId:payload.requestId});
    const path=join(runsDirectory,operationId+'.json'),requestSha256=requestIdentity('capture_resources',payload);
    let journal;
    try{
      journal=await readJson(path,MAX_STATE_BYTES);
      requireThat(journal.schema==='stellar-forge.samgov-resource-run.v1' &&
        journal.requestSha256===requestSha256,'RESOURCE_OPERATION_CHANGED');
    }catch(error){if(error.code!=='ENOENT')throw error;
      journal={schema:'stellar-forge.samgov-resource-run.v1',id:operationId,requestSha256,createdAt:at,
        editionId:parent.record.id,tasks,results:[],pending:null,completedAt:null};
      await writeJson(path,journal,{exclusive:true});
    }
    const additions=new Map(),resultCounts={retained:0,unavailable:0};
    for(const task of tasks){
      signal?.throwIfAborted();
      const key=task.noticeId+'\n'+task.kind+'\n'+task.url;
      let result=journal.results.find(row=>row.key===key);
      if(!result){
        journal.pending={key,...task,startedAt:now()};await writeJson(path,journal);
        try{
          const receipt=await transport.fetchSource({...task,signal});
          const source=await retainedSource(receipt,{kind:task.kind,noticeId:task.noticeId});
          result={key,...task,source,resource:resourceRecord(source,task.kind,task.url)};
        }catch(error){
          if(signal?.aborted || ['SOURCE_CANCELLED','WORKSPACE_CLOSED'].includes(error.code))throw error;
          result={key,...task,source:null,resource:{sourceId:null,kind:task.kind,url:task.url,
            filename:task.kind==='description'?task.noticeId+'-description.html':'attachment',
            mediaType:null,bytes:0,sha256:null,capturedAt:now(),status:'unavailable',error:controlledError(error)}};
        }
        journal.results.push(result);journal.pending=null;await writeJson(path,journal);
      }
      if(result.source){
        const bytes=await objectBytes(result.source.sha256,MAX_SOURCE_BYTES);
        requireThat(bytes.length===result.source.bytes,'RESOURCE_SOURCE_CHANGED');addSources(state,[result.source]);
      }
      if(result.resource.status===200)resultCounts.retained++;else resultCounts.unavailable++;
      if(!additions.has(task.noticeId))additions.set(task.noticeId,[]);
      additions.get(task.noticeId).push(copy(result.resource));
    }
    const rows=parent.rows.map(row=>{
      const received=additions.get(row.noticeId);if(!received)return copy(row);
      const replaced=new Set(received.map(item=>item.kind+'\n'+item.url));
      const resources=row.resources.filter(item=>!replaced.has(item.kind+'\n'+item.url)).concat(received);
      return rebuildNotice(row,resources);
    });
    const edition=await retainEdition(state,{name:parent.record.name+' — retained resources',
      kind:'resource_enriched',captureId:parent.record.captureId,parentEditionId:parent.record.id,
      querySha256:parent.record.querySha256,complete:parent.record.complete,sourceBasis:parent.record.sourceBasis,rows});
    journal.completedAt=now();journal.editionIdResult=edition.id;await writeJson(path,journal);
    return {editionId:edition.id,parentEditionId:parent.record.id,operationId,...resultCounts};
  }
  async function manualResource(state,payload){
    requireThat(['description','attachment'].includes(payload.kind),'RESOURCE_KIND_INVALID');
    const parent=await editionData(payload.editionId,state),row=parent.rows.find(row=>row.noticeId===payload.noticeId);
    requireThat(row,'NOTICE_NOT_FOUND','Select a notice from the retained edition.',404);
    const available=selectedResources(row);
    requireThat(available.some(item=>item.kind===payload.kind && item.url===payload.url),'RESOURCE_NOT_IN_NOTICE',
      'The original downloaded resource must match a URL retained by this notice.');
    const url=cleanSourceUrl(payload.url);
    let receipt={url,request:null,status:'received_file',capturedAt:payload.capturedAt,
      filename:payload.filename,mediaType:payload.mediaType,body:sourceBuffer(payload),headers:{},redirects:[]};
    if(payload.response!==undefined){
      requireThat(plain(payload.response),'SOURCE_RESPONSE_INVALID',
        'Supply the original HTTP response metadata, or receive the original file without an HTTP receipt.');
      compareRequest(payload.response.request,{url});
      requireThat(Number.isInteger(payload.response.status) && payload.response.status>=100 &&
        payload.response.status<=599,'SOURCE_RESPONSE_INVALID');
      receipt={...receipt,request:{method:'GET',url},status:payload.response.status,
        headers:safeHeaders(payload.response.headers??{})};
    }
    const source=await retainedSource(receipt,{kind:payload.kind,noticeId:row.noticeId});
    addSources(state,[source]);
    const received=resourceRecord(source,payload.kind,payload.url),rows=parent.rows.map(item=>{
      if(item.noticeId!==row.noticeId)return copy(item);
      return rebuildNotice(item,item.resources.filter(resource=>
        !(resource.kind===payload.kind && resource.url===payload.url)).concat([received]));
    });
    const edition=await retainEdition(state,{name:parent.record.name+' — retained resource',
      kind:'resource_enriched',captureId:parent.record.captureId,parentEditionId:parent.record.id,
      querySha256:parent.record.querySha256,complete:parent.record.complete,sourceBasis:parent.record.sourceBasis,rows});
    return {sourceId:source.id,editionId:edition.id,parentEditionId:parent.record.id};
  }
  async function dispatch(action,payload={},options={}){
    ensure();text(action,'Action',100);requireThat(plain(payload),'ACTION_PAYLOAD_INVALID');
    if(action==='view')return list();
    if(action==='get')return get(payload.id,payload);
    if(action==='notice')return notice(payload.editionId,payload.noticeId);
    if(action==='read_source')return readSource(payload.sourceId);
    if(action==='compare')return compare(payload.beforeEditionId,payload.afterEditionId);
    if(action==='cancel_capture')return cancelCapture(payload.captureId);
    if(action==='run_capture'){
      const accepted=await commit('request_capture_run',payload,async state=>{
        const capture=record(state,'captures',payload.captureId);
        return {captureId:capture.id};
      });
      const capture=record(await current(),'captures',payload.captureId);
      if(capture.status==='complete' || active.has(capture.id))
        return {workspace:await list(),result:{captureId:capture.id,editionId:capture.editionId,status:capture.status}};
      return runCapture(capture.id,options);
    }
    const actions=new Set(['save_query','start_capture','resize_capture','import_capture','save_selection',
      'review_notice','review_change','create_handoff','capture_resources','retain_resource','import_notice',
      'prepare_merchant','buyer_review','prepare_buyer','prepare_opportunity']);
    requireThat(actions.has(action),'ACTION_UNKNOWN','Unknown SAM workspace action: '+action);
    return commit(action,payload,async(state,context)=>{
      const {at,nextRevision}=context;
      if(action==='save_query'){
        const definition=queryDefinition({filters:payload.filters,pageSize:payload.pageSize,
          maxRecords:payload.maxRecords,sourceTerms:payload.sourceTerms});
        const name=text(payload.name,'Query name',500);
        let query;
        if(payload.queryId){
          query=record(state,'queries',payload.queryId);
          Object.assign(query,{name,definition,revision:query.revision+1,updatedAt:at});
        }else{
          query={id:newId('query'),name,definition,revision:1,createdAt:at,updatedAt:at};state.queries.push(query);
        }
        return {queryId:query.id,queryRevision:query.revision};
      }
      if(action==='start_capture'){
        const query=record(state,'queries',payload.queryId);
        integer(payload.queryRevision,'Query revision',1,Number.MAX_SAFE_INTEGER);
        requireThat(payload.queryRevision===query.revision,'QUERY_REVISION_CHANGED',
          'Reopen the current query definition before starting its next observation.',409);
        const captureId=newId('capture'),definition=copy(query.definition),
          querySha256=queryIdentity(definition,selectedEndpoint),
          progress=freshProgress(captureId,definition,querySha256,selectedEndpoint,at);
        const capture=captureSummary({id:captureId,name:text(payload.name??query.name,'Capture name',500),
          queryId:query.id,queryRevision:query.revision,definition,endpoint:selectedEndpoint,querySha256,
          editionId:null,manifestSha256:await putObject(jsonBytes(progress))},progress);
        state.captures.push(capture);await writeProgress(progress);
        return {captureId,queryId:query.id,status:'queued'};
      }
      if(action==='resize_capture'){
        const capture=record(state,'captures',payload.captureId);
        requireThat(!active.has(capture.id) && capture.status!=='complete','CAPTURE_CAPACITY_ACTIVE',
          'Pause the original incomplete capture before changing its capacity.',409);
        const maximum=integer(payload.maxRecords,'Capture record capacity',1,MAX_RECORDS),
          progress=validateProgress(await readProgress(capture),capture);
        requireThat(maximum>=progress.count,'CAPTURE_CAPACITY_BELOW_RETAINED',
          'The new capacity must include every already retained record.');
        progress.definition={...progress.definition,maxRecords:maximum};progress.status='paused';
        progress.error=null;progress.updatedAt=at;await writeProgress(progress);
        Object.assign(capture,captureSummary(capture,progress),{definition:copy(progress.definition),
          manifestSha256:await putObject(jsonBytes(progress))});
        return {captureId:capture.id,maxRecords:maximum,status:'paused'};
      }
      if(action==='import_capture')return importedCapture(state,payload,context);
      if(action==='import_notice')return importedNotice(state,payload,context);
      if(action==='save_selection'){
        const edition=await editionData(payload.editionId,state),
          noticeIds=uniqueStrings(payload.noticeIds,'Selected notice IDs'),
          known=new Set(edition.rows.map(row=>row.noticeId));
        requireThat(noticeIds.every(id=>known.has(id)),'SELECTION_NOTICE_MISSING',
          'Every selected notice must occur in the chosen immutable edition.');
        const fields={name:text(payload.name,'Selection name',500),editionId:edition.record.id,noticeIds,
          notes:text(payload.notes??'','Selection notes',20000,true),updatedAt:at};
        let selection;
        if(payload.selectionId){
          selection=record(state,'selections',payload.selectionId);
          Object.assign(selection,fields,{revision:selection.revision+1});
        }else{
          selection={id:newId('selection'),revision:1,createdAt:at,...fields};state.selections.push(selection);
        }
        return {selectionId:selection.id,selectionRevision:selection.revision,editionId:edition.record.id};
      }
      if(action==='review_notice'){
        const edition=await editionData(payload.editionId,state),
          row=edition.rows.find(row=>row.noticeId===payload.noticeId);
        requireThat(row,'NOTICE_NOT_FOUND','Select a notice from the reviewed edition.',404);
        requireThat(['unreviewed','watching','qualified','declined','needs_review'].includes(payload.status),
          'NOTICE_REVIEW_STATUS_INVALID');
        const review={id:newId('review'),editionId:edition.record.id,noticeId:row.noticeId,
          recordSha256:row.recordSha256,status:payload.status,owner:text(payload.owner,'Review owner',240),
          notes:text(payload.notes??'','Review notes',40000,true),deadline:reviewDeadline(payload.deadline),
          createdAt:at,createdBy:operator,revision:nextRevision};
        state.reviews.push(review);return {reviewId:review.id,editionId:edition.record.id,noticeId:row.noticeId};
      }
      if(action==='review_change'){
        const before=await editionData(payload.beforeEditionId,state),after=await editionData(payload.afterEditionId,state);
        requireThat(before.record.id!==after.record.id,'CHANGE_EDITIONS_REQUIRED');
        const difference=compareNotices(before.rows,after.rows).items.find(row=>row.noticeId===payload.noticeId);
        requireThat(difference,'CHANGE_NOTICE_MISSING');
        requireThat(['reviewed','follow_up','dismissed'].includes(payload.decision),'CHANGE_DECISION_INVALID');
        const change={id:newId('change'),beforeEditionId:before.record.id,afterEditionId:after.record.id,
          noticeId:difference.noticeId,kind:difference.kind,changedFields:difference.changedFields,
          beforeSha256:difference.before?.recordSha256??null,afterSha256:difference.after?.recordSha256??null,
          decision:payload.decision,owner:text(payload.owner,'Change owner',240),
          note:text(payload.note,'Change review note',40000),createdAt:at,createdBy:operator,revision:nextRevision};
        state.changes.push(change);return {changeId:change.id,noticeId:change.noticeId,kind:change.kind};
      }
      if(action==='create_handoff'){
        requireThat(active.size===0,'CAPTURE_ACTIVE','Pause the original capture before freezing its full handoff.',409);
        const selected=await selectedRows(payload.selectionId,state),
          sourceRecord=context.history.at(-1);
        requireThat(sourceRecord,'HANDOFF_SOURCE_REQUIRED');
        const handoff={id:newId('handoff'),name:text(payload.name,'Handoff name',500),
          note:text(payload.note??'','Handoff note',40000,true),
          selectionId:selected.selection.id,selectionRevision:selected.selection.revision,
          editionId:selected.edition.id,sourceRevision:state.revision,sourceStateSha256:sourceRecord.sha256,
          revision:nextRevision,createdAt:at,createdBy:operator};
        state.handoffs.push(handoff);return {handoffId:handoff.id,revision:nextRevision,
          selectionId:handoff.selectionId,editionId:handoff.editionId};
      }
      if(action==='capture_resources')return resourceEdition(state,payload,context,options);
      if(action==='retain_resource')return manualResource(state,payload);
      if(action==='prepare_merchant'){
        const selected=await selectedRows(payload.selectionId,state),
          publicationId='publication_'+sha({workspaceId:state.id,requestId:payload.requestId});
        const {prepareSamMerchant}=await import('./merchant.mjs');
        const prepared=await prepareSamMerchant({directory:join(directory,'merchant',publicationId),
          publicationId,workspaceId:state.id,sourceRevision:state.revision,...selected,
          sources:state.sources.filter(source=>selected.rows.some(row=>noticeSourceIds(row).includes(source.id))),
          capture:copy(state.captures.find(capture=>capture.id===selected.edition.captureId)??null),
          payment:payload.payment,origin:payload.origin,path:payload.path,
          defaultLimit:payload.defaultLimit,maxLimit:payload.maxLimit});
        const files=[];
        for(const file of prepared.files){
          const bytes=await readBytes(file.absolutePath,MAX_PACKET_BYTES),sha256=await putObject(bytes);
          requireThat(sha256===file.sha256 && bytes.length===file.bytes,'MERCHANT_FILE_CHANGED');
          files.push({path:file.path,sha256,bytes:bytes.length});
        }
        const publication={id:publicationId,kind:'merchant',selectionId:selected.selection.id,
          selectionRevision:selected.selection.revision,editionId:selected.edition.id,
          sourceRevision:state.revision,sourceStateSha256:context.history.at(-1).sha256,
          createdAt:at,createdBy:operator,directory:'merchant/'+publicationId,files,
          bundle:prepared.bundle,snapshot:prepared.bundle.dataset.snapshot,
          seller:prepared.bundle.seller,buyerReviews:[],buyerPreparations:[]};
        state.publications.push(publication);
        return {publicationId,snapshot:publication.snapshot,files:copy(files),
          launch:prepared.launch};
      }
      if(action==='buyer_review'){
        const publication=record(state,'publications',payload.publicationId);
        requireThat(publication.kind==='merchant','MERCHANT_PUBLICATION_REQUIRED');
        const {reviewSamBuyer}=await import('./merchant.mjs');
        const review=await reviewSamBuyer({directory:join(directory,publication.directory),
          seller:payload.seller,query:payload.query??{}});
        const reviewId=newId('buyer_review');
        publication.buyerReviews.push({id:reviewId,...copy(review),createdAt:at,createdBy:operator});
        return {publicationId:publication.id,reviewId,review:copy(review)};
      }
      if(action==='prepare_buyer'){
        const publication=record(state,'publications',payload.publicationId),
          review=publication.buyerReviews.find(row=>row.id===payload.reviewId);
        requireThat(review,'BUYER_REVIEW_REQUIRED','Load and review this original seller offer first.',409);
        const {prepareSamBuyer}=await import('./merchant.mjs');
        const prepared=await prepareSamBuyer({directory:join(directory,publication.directory),review,
          intentId:payload.intentId,acceptIndex:payload.acceptIndex,offerSha256:payload.offerSha256});
        const preparationId=newId('buyer_preparation');
        publication.buyerPreparations.push({id:preparationId,...copy(prepared),createdAt:at,createdBy:operator});
        return {publicationId:publication.id,preparationId,...prepared};
      }
      if(action==='prepare_opportunity'){
        requireThat(opportunityDirectory,'OPPORTUNITY_DIRECTORY_REQUIRED',
          'Configure the original opportunity workspace in the trusted server or CLI launch.',409);
        const selected=await selectedRows(payload.selectionId,state),
          row=selected.rows.find(row=>row.noticeId===payload.noticeId);
        requireThat(row,'NOTICE_NOT_SELECTED','Select this notice in the retained selection.');
        const {prepareSamOpportunity}=await import('./opportunity.mjs');
        const inputs=[];
        for(const sourceId of noticeSourceIds(row,{successfulResourcesOnly:true})){
          const source=await sourceRecord(sourceId,state);
          inputs.push({...copy(source),contentBase64:(await objectBytes(source.sha256,MAX_SOURCE_BYTES)).toString('base64')});
        }
        const result=await prepareSamOpportunity({directory:resolve(opportunityDirectory),
          journalDirectory:join(directory,'opportunity'),operator,requestId:payload.requestId,
          workspaceId:state.id,sourceRevision:state.revision,selection:selected.selection,edition:selected.edition,
          notice:row,sources:inputs,projectId:payload.projectId,
          expectedProjectRevision:payload.expectedProjectRevision,title:payload.title,
          documentKind:payload.documentKind,deadline:payload.deadline});
        const publication={id:newId('publication'),kind:'opportunity',selectionId:selected.selection.id,
          selectionRevision:selected.selection.revision,editionId:selected.edition.id,noticeId:row.noticeId,
          sourceRevision:state.revision,sourceStateSha256:context.history.at(-1).sha256,
          createdAt:at,createdBy:operator,projectId:result.projectId,projectRevision:result.revision,
          sourceBindings:result.sourceBindings,bridgeId:result.bridgeId,files:[]};
        state.publications.push(publication);
        return {publicationId:publication.id,...result};
      }
    });
  }

  async function exportPacket({revision,selectionId,handoffId}={}){
    ensure();requireThat(active.size===0,'CAPTURE_ACTIVE',
      'Pause the original capture before exporting its complete receiving state.',409);
    await tail;
    const history=await allHistory();
    requireThat(history.length>0,'WORKSPACE_EMPTY','Retain a source query or capture before exporting.');
    requireThat(!(handoffId && revision!==undefined),'HANDOFF_REVISION_FIXED',
      'A named handoff selects its original fixed revision.');
    let selectedHistory=history,createdAt=now();
    if(handoffId){
      const handoff=record(history.at(-1).state,'handoffs',handoffId);
      if(selectionId!==undefined)requireThat(selectionId===handoff.selectionId,'HANDOFF_SELECTION_FIXED');
      selectionId=handoff.selectionId;revision=handoff.revision;createdAt=handoff.createdAt;
    }
    if(revision!==undefined){
      integer(revision,'Export revision',1,history.length);selectedHistory=history.slice(0,revision);
    }
    const state=selectedHistory.at(-1).state;
    if(selectionId)record(state,'selections',selectionId);
    if(handoffId)record(state,'handoffs',handoffId);
    const editions=[];
    for(const edition of state.editions){
      const retained=await editionData(edition.id,state);editions.push({...retained.record,rows:retained.rows});
    }
    const objects=[];let size=0;
    for(const digest of requiredReferences(selectedHistory.map(row=>row.state))){
      const body=await objectBytes(digest);size+=body.length;
      requireThat(size<=Math.floor(MAX_PACKET_BYTES*0.6),'PACKET_CAPACITY',
        'The complete original source history exceeds this portable packet capacity.',413);
      objects.push({sha256:digest,bytes:body.length,contentBase64:body.toString('base64')});
    }
    const packet={schema:SAM_PACKET_SCHEMA,id:state.id,revision:state.revision,createdAt,
      selectionId:selectionId??null,handoffId:handoffId??null,
      workspace:historicalView(state,selectedHistory),versions:copy(selectedHistory),editions,
      sources:copy(state.sources),objects};
    packet.sha256=sha(packet);
    requireThat(jsonBytes(packet).length<=MAX_PACKET_BYTES,'PACKET_CAPACITY',
      'The complete original source history exceeds this portable packet capacity.',413);
    return packet;
  }
  function privateRelative(value){
    text(value,'Retained relative path',1000);
    requireThat(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
      value.split('/').every(part=>part && part!=='.' && part!=='..'),
      'PORTABLE_PATH_INVALID');
    return value;
  }
  function packetSource(source,objects){
    requireThat(plain(source) && /^src_[a-f0-9]{64}$/.test(source.id),'SOURCE_RECORD_INVALID');
    const identity=copy(source);delete identity.id;
    requireThat(source.id==='src_'+sha(identity),'SOURCE_RECORD_CHANGED');
    cleanSourceUrl(source.url);
    requireThat(validSourceAcquisition(source),'SOURCE_RECORD_INVALID');
    if(source.status!=='received_file')compareRequest(source.request,{url:source.url});
    instant(source.capturedAt);text(source.filename,'Source filename',240);
    requireThat(source.filename===safeFilename(source.filename) &&
      HASH.test(source.originalSha256) && canonical(safeHeaders(source.headers))===canonical(source.headers),
      'SOURCE_RECORD_INVALID');
    const body=objects.get(source.sha256);
    requireThat(body && body.length===source.bytes,'SOURCE_BYTES_MISSING');
    return body;
  }
  function packetEdition(edition,objects,sources,parsedSources){
    const body=objects.get(edition.objectSha256);
    requireThat(body,'EDITION_BYTES_MISSING');
    let original;try{original=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}
    catch{throw new SamError('EDITION_JSON_INVALID');}
    requireThat(original.schema==='stellar-forge.samgov-edition.v1' && original.id===edition.id &&
      Array.isArray(original.rows) && original.rows.length===edition.rowCount &&
      sha(original.rows)===edition.sha256,'EDITION_CHANGED');
    const ids=new Set(),sourceIds=new Set();
    for(const row of original.rows){
      requireThat(plain(row) && plain(row.source) && Array.isArray(row.resources) &&
        !ids.has(row.noticeId),'EDITION_ROW_INVALID');ids.add(row.noticeId);
      const source=sources.get(row.source.sourceId);
      requireThat(source && source.sha256===row.source.sha256 &&
        source.capturedAt===row.source.capturedAt && source.url===row.source.url,'NOTICE_SOURCE_CHANGED');
      sourceIds.add(source.id);
      let parsed=parsedSources.get(source.id);
      if(!parsed){parsed=sourceJSON(objects.get(source.sha256));parsedSources.set(source.id,parsed);}
      if(row.source.format===NOTICE_DOCUMENT_FORMAT){
        requireThat(source.kind==='notice_record' && source.noticeId===row.noticeId &&
          (source.status===200 || source.status==='received_file') && row.source.rowPointer==='' &&
          row.source.pageOffset===null && canonical(parsed)===canonical(row.raw),'NOTICE_DOCUMENT_SOURCE_CHANGED');
        validateNoticeDocumentUrl(source.url,'notice_record',row.noticeId);
        const companions=row.source.companions,parts={notice:parsed};
        requireThat(Array.isArray(companions) && companions.length<=2 &&
          new Set(companions.map(item=>item.kind)).size===companions.length,'NOTICE_DOCUMENT_COMPANIONS_CHANGED');
        for(const companion of companions){
          const retained=sources.get(companion.sourceId);
          requireThat(['notice_resources','notice_history'].includes(companion.kind) &&
            retained && retained.kind===companion.kind && retained.noticeId===row.noticeId &&
            (retained.status===200 || retained.status==='received_file') &&
            companion.sha256===retained.sha256 && companion.capturedAt===retained.capturedAt &&
            companion.url===retained.url && companion.rowPointer==='','NOTICE_DOCUMENT_COMPANION_CHANGED');
          validateNoticeDocumentUrl(retained.url,retained.kind,row.noticeId);sourceIds.add(retained.id);
          const key=retained.kind==='notice_resources'?'resources':'history';
          parts[key]=sourceJSON(objects.get(retained.sha256));
        }
        requireThat(canonical(row)===canonical(noticeDocumentRow(parts,row.source,row.resources)),
          'NOTICE_DOCUMENT_VIEW_CHANGED');
      }else{
        requireThat(source.kind==='search_page' && source.status===200,'NOTICE_SOURCE_CHANGED');
        const pointer=/^\/opportunitiesData\/(0|[1-9]\d*)$/.exec(row.source.rowPointer??'');
        requireThat(pointer,'NOTICE_SOURCE_POINTER_INVALID');
        requireThat(Array.isArray(parsed.opportunitiesData) &&
          canonical(parsed.opportunitiesData[Number(pointer[1])])===canonical(row.raw) &&
          String(parsed.offset)===String(row.source.pageOffset),'NOTICE_SOURCE_BYTES_CHANGED');
      }
      const available=selectedResources(row);
      const resourceKeys=new Set();
      for(const resource of row.resources){
        const key=resource.kind+'\n'+resource.url;
        requireThat(!resourceKeys.has(key) &&
          available.some(item=>item.kind===resource.kind && item.url===resource.url),'RESOURCE_LINK_CHANGED');
        resourceKeys.add(key);
        if(resource.sourceId){
          const retained=sources.get(resource.sourceId);
          requireThat(retained && retained.noticeId===row.noticeId && retained.kind===resource.kind &&
            retained.url===resource.url && canonical(resource)===canonical(resourceRecord(retained,resource.kind,resource.url)),
            'RESOURCE_SOURCE_CHANGED');
          sourceIds.add(retained.id);
        }else requireThat(resource.status==='unavailable' && resource.sha256===null &&
          resource.bytes===0 && plain(resource.error),'RESOURCE_FAILURE_CHANGED');
      }
      requireThat(canonical(row)===canonical(rebuildNotice(row)),'NOTICE_VIEW_CHANGED',
        'The portable notice view differs from its original source record.');
    }
    requireThat(edition.sourceCount===sourceIds.size &&
      canonical([...sourceIds].sort())===canonical([...edition.sourceIds].sort()),'EDITION_SOURCE_SET_CHANGED');
    return original.rows;
  }
  async function validatePacket(packet){
    requireThat(plain(packet) && packet.schema===SAM_PACKET_SCHEMA &&
      typeof packet.id==='string' && Number.isSafeInteger(packet.revision) &&
      Array.isArray(packet.versions) && packet.versions.length===packet.revision && packet.revision>=1 &&
      Array.isArray(packet.objects) && Array.isArray(packet.editions) && Array.isArray(packet.sources),
      'PACKET_INVALID');
    requireThat(jsonBytes(packet).length<=MAX_PACKET_BYTES,'PACKET_CAPACITY','Portable packet exceeds its byte capacity.',413);
    const unsigned=copy(packet);delete unsigned.sha256;
    requireThat(sha(unsigned)===packet.sha256,'PACKET_HASH_CHANGED');
    instant(packet.createdAt,'Packet creation time');
    let previous=null;
    for(let index=0;index<packet.versions.length;index++){
      envelope(packet.versions[index],packet.id,index+1,previous);previous=packet.versions[index].sha256;
    }
    const state=packet.versions.at(-1).state;
    requireThat(canonical(packet.workspace)===canonical(historicalView(state,packet.versions)),
      'PACKET_WORKSPACE_VIEW_CHANGED','The portable full view differs from its original revision history.');
    const objects=new Map();
    for(const object of packet.objects){
      requireThat(plain(object) && HASH.test(object.sha256) && !objects.has(object.sha256),'PACKET_OBJECT_INVALID');
      const body=sourceBuffer(object,{limit:MAX_PACKET_BYTES});
      requireThat(body.length===object.bytes && sha(body)===object.sha256,'PACKET_OBJECT_CHANGED');
      objects.set(object.sha256,body);
    }
    const required=requiredReferences(packet.versions.map(record=>record.state));
    requireThat(canonical([...objects.keys()].sort())===canonical(required),'PACKET_OBJECT_SET_CHANGED',
      'The portable source object set is incomplete or includes unselected private objects.');
    const parsedSources=new Map(),editionRows=new Map();
    for(const version of packet.versions){
      const current=version.state,sources=new Map(current.sources.map(source=>[source.id,source]));
      for(const source of current.sources)packetSource(source,objects);
      for(const edition of current.editions){
        if(!editionRows.has(edition.objectSha256))
          editionRows.set(edition.objectSha256,packetEdition(edition,objects,sources,parsedSources));
        else requireThat(sha(editionRows.get(edition.objectSha256))===edition.sha256,'EDITION_CHANGED');
        if(edition.parentEditionId){
          const parent=record(current,'editions',edition.parentEditionId);
          if(edition.kind!=='notice_document_observation')requireThat(parent.querySha256===edition.querySha256,'EDITION_PARENT_CHANGED');
          if(edition.kind==='resource_enriched'){
            const parentRows=editionRows.get(parent.objectSha256) ??
              packetEdition(parent,objects,sources,parsedSources);
            requireThat(canonical(parentRows.map(row=>[row.noticeId,row.raw,row.source]))===
              canonical(editionRows.get(edition.objectSha256).map(row=>[row.noticeId,row.raw,row.source])),
              'RESOURCE_EDITION_NOTICE_CHANGED');
          }
        }
      }
      for(const capture of current.captures){
        const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(objects.get(capture.manifestSha256)));
        validateProgress(manifest,capture);
        requireThat(sha(jsonBytes(manifest))===capture.manifestSha256 &&
          canonical(capture.definition)===canonical(manifest.definition),'CAPTURE_MANIFEST_CHANGED');
        requireThat(capture.count===manifest.count && capture.nextOffset===manifest.nextOffset &&
          capture.totalRecords===manifest.totalRecords && capture.pageCount===manifest.pages.length &&
          capture.status===manifest.status,'CAPTURE_MANIFEST_CHANGED');
        const seen=new Set();let count=0;
        for(const page of manifest.pages){
          const source=sources.get(page.sourceId);
          requireThat(source && manifest.sources.some(item=>canonical(item)===canonical(source)) &&
            source.sha256===page.sha256 && source.status===200,'CAPTURE_SOURCE_CHANGED');
          const expected=searchRequest(capture.definition,page.offset,capture.endpoint);
          compareRequest(source.request,expected);
          const parsed=parseSearchPage(objects.get(source.sha256),expected);
          requireThat(parsed.rows.length===page.count && parsed.totalRecords===manifest.totalRecords,'CAPTURE_PAGE_CHANGED');
          for(const row of parsed.rows){
            const id=identifier(row.noticeId,'Original notice ID');
            requireThat(!seen.has(id),'DUPLICATE_NOTICE_IN_CAPTURE');seen.add(id);
          }
          count+=parsed.rows.length;
        }
        requireThat(count===capture.count && (capture.status!=='complete' ||
          manifest.pending===null && count===capture.totalRecords),'CAPTURE_COMPLETENESS_CHANGED');
      }
      for(const handoff of current.handoffs){
        const basis=packet.versions[handoff.sourceRevision-1];
        requireThat(basis && basis.sha256===handoff.sourceStateSha256,'HANDOFF_BASIS_CHANGED');
        const selection=record(basis.state,'selections',handoff.selectionId);
        requireThat(selection.revision===handoff.selectionRevision && selection.editionId===handoff.editionId,
          'HANDOFF_SELECTION_CHANGED');
      }
      for(const publication of current.publications){
        requireThat(['merchant','opportunity'].includes(publication.kind),'PUBLICATION_KIND_INVALID');
        if(publication.kind==='merchant'){
          requireThat(publication.directory==='merchant/'+publication.id,'PUBLICATION_DIRECTORY_CHANGED');
          const names=new Set();
          for(const file of publication.files){
            privateRelative(file.path);requireThat(!names.has(file.path),'PUBLICATION_FILE_DUPLICATE');names.add(file.path);
            requireThat(objects.get(file.sha256)?.length===file.bytes,'PUBLICATION_FILE_CHANGED');
          }
        }
      }
    }
    requireThat(canonical(packet.sources)===canonical(state.sources),'PACKET_SOURCE_VIEW_CHANGED');
    const projected=state.editions.map(edition=>({...copy(edition),rows:editionRows.get(edition.objectSha256)}));
    requireThat(canonical(projected)===canonical(packet.editions),'PACKET_EDITION_VIEW_CHANGED');
    if(packet.selectionId)record(state,'selections',packet.selectionId);
    if(packet.handoffId){
      const handoff=record(state,'handoffs',packet.handoffId);
      requireThat(handoff.revision===packet.revision && handoff.selectionId===packet.selectionId &&
        handoff.createdAt===packet.createdAt,'PACKET_NAMED_HANDOFF_CHANGED');
    }
    return {state,objects};
  }
  async function materializePublications(state){
    for(const publication of state.publications){
      if(publication.kind!=='merchant')continue;
      const target=await privateDirectory(join(directory,'merchant',publication.id));
      for(const file of publication.files){
        const name=privateRelative(file.path),segments=name.split('/');
        if(segments.length>1)await privateDirectory(join(target,...segments.slice(0,-1)));
        const bytes=await objectBytes(file.sha256),path=join(target,name);
        try{await writeBytes(path,bytes,{exclusive:true});}
        catch(error){if(error.code!=='EEXIST')throw error;
          requireThat(sha(await readBytes(path,MAX_PACKET_BYTES))===file.sha256,'PUBLICATION_FILE_CHANGED');}
      }
    }
  }
  async function importPacket(input){
    ensure(true);requireThat(active.size===0,'CAPTURE_ACTIVE','Pause the original capture before receiving another edition.',409);
    let packet=input;
    if(Buffer.isBuffer(input) || typeof input==='string'){
      const body=Buffer.isBuffer(input)?input:Buffer.from(input,'utf8');
      requireThat(body.length<=MAX_PACKET_BYTES,'PACKET_CAPACITY');
      try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}
      catch{throw new SamError('PACKET_JSON_INVALID');}
    }
    return serialize(async()=>{
      ensure(true);
      requireThat(active.size===0,'CAPTURE_ACTIVE','Pause the original capture before receiving another edition.',409);
      receiving=true;
      try{
        const verified=await validatePacket(packet),history=await allHistory();
        requireThat(history.length===0 || history[0].state.id===packet.id,'WORKSPACE_ID_CONFLICT',
          'Receive a different workspace into a new private directory.',409);
        const shared=Math.min(history.length,packet.versions.length);
        for(let index=0;index<shared;index++)requireThat(history[index].sha256===packet.versions[index].sha256,
          'WORKSPACE_HISTORY_DIVERGED','This workspace and the incoming packet have different original history.',409);
        const before=history.at(-1)?.state,targetHistory=packet.versions.length>history.length?packet.versions:history,
          state=targetHistory.at(-1).state,progressWrites=[];
        for(const capture of state.captures){
          const frozen=verified.objects.has(capture.manifestSha256)?
            JSON.parse(verified.objects.get(capture.manifestSha256).toString('utf8')):
            await objectJson(capture.manifestSha256);
          let local;
          try{local=await readJson(runFile(capture.id),MAX_STATE_BYTES);}
          catch(error){if(error.code!=='ENOENT')throw error;progressWrites.push(frozen);continue;}
          validateProgress(local,capture);
          const digest=sha(jsonBytes(local));
          if(digest===capture.manifestSha256)continue;
          const historical=targetHistory.some(version=>version.state.captures.some(row=>
            row.id===capture.id && row.manifestSha256===digest));
          if(historical){progressWrites.push(frozen);continue;}
          const previous=before?.captures.find(row=>row.id===capture.id);
          requireThat(previous?.manifestSha256===capture.manifestSha256,'CAPTURE_PROGRESS_CONFLICT',
            'This receiver has additional local capture progress; resume and retain its original checkpoint before importing a changed capture.',
            409,{captureId:capture.id});
        }
        for(const [digest,bytes] of verified.objects)requireThat(await putObject(bytes)===digest,'PACKET_OBJECT_CHANGED');
        for(let index=history.length;index<packet.versions.length;index++){
          await writeBytes(join(revisionsDirectory,revisionFile(index+1)),jsonBytes(packet.versions[index]),{exclusive:true});
          history.push(copy(packet.versions[index]));cache=[...history];
        }
        await materializePublications(state);
        for(const progress of progressWrites)await writeProgress(progress);
        return list({internal:true});
      }finally{receiving=false;}
    });
  }
  async function close(){
    if(closed)return;
    if(closing){await tail;await Promise.allSettled([...active.values()].map(run=>run.promise));return;}
    closing=true;
    for(const run of active.values())run.controller.abort(new SamError('SOURCE_CANCELLED'));
    await transport.close();
    await Promise.allSettled([...active.values()].map(run=>run.promise));
    await tail;
    try{await lease?.release();}finally{closed=true;}
  }
  try{
    const state=await current();
    if(!readOnly && state.captures.some(capture=>capture.status==='running')){
      for(const capture of state.captures.filter(capture=>capture.status==='running')){
        const progress=validateProgress(await readProgress(capture),capture);
        progress.status='paused';progress.updatedAt=now();progress.error={code:'CAPTURE_OWNER_REOPENED',
          message:'The original capture owner ended; resume this retained page cursor.',status:409};
        if(progress.pending){
          const retained=await retainedAttempt(progress,progress.pending);
          if(retained){
            try{
              const accepted=await acceptAttempt(progress,retained,
                new Set((await rowsForProgress(progress)).map(row=>row.noticeId)));
              if(accepted && progress.totalRecords!==null && progress.count===progress.totalRecords){
                progress.status='complete';progress.completedAt=now();progress.error=null;
              }
            }catch(error){progress.status='failed';progress.error=controlledError(error);}
          }
        }
        await writeProgress(progress);
        await finishCapture(progress,{action:'capture_owner_reopened'});
      }
    }
    return Object.freeze({directory,list,get,dispatch,readSource,exportPacket,importPacket,
      runCapture,cancelCapture,compare,close});
  }catch(error){await transport.close();await lease?.release();closed=true;throw error;}
}

