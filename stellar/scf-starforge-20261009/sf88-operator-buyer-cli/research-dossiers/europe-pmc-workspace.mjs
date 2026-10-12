// MIT. Europe PMC saved searches, source editions and receiving in the original Research application.
import {readdir, lstat, mkdir} from 'node:fs/promises';
import {join, resolve, dirname, basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {privateDirectory, readJson, readBytes, writeJson, writeBytes, exists} from '../node/store.mjs';
import {withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {searchSelection, requestFor, readSearchPage, sourceDocument, validateDocument, buildEdition, validateEdition,
  compareEditions, fetchSearchDocument, exportRIS, exportCSV, canonical, sha256, jsonBytes, parseJson, need, object,
  MAX_PAGE_BYTES, MAX_RAW_BYTES, MAX_EDITION_BYTES, SOURCE_TERMS, editionPagination, estimatePageBytes} from '../../sf30-seller-sdk/europe-pmc/source.mjs';

const LIBRARY = 'stellar-forge.europe-pmc-workspace.v1', PLAN = 'stellar-forge.europe-pmc-plan.v1',
  OPERATION = 'stellar-forge.europe-pmc-operation.v1', PORTABLE = 'stellar-forge.europe-pmc-portable.v1';
const CONTROL_LIMIT = 64 * 1024 * 1024, PORTABLE_LIMIT = 128 * 1024 * 1024;
const stamp = () => new Date().toISOString(), same = (a,b) => canonical(a) === canonical(b);
const id = (value, prefix) => {need(typeof value === 'string' && new RegExp('^' + prefix + '_[a-f0-9]{64}$').test(value), 'EUROPE_PMC_ID_INVALID'); return value;};
const requestId = value => {need(typeof value === 'string' && /^[A-Za-z0-9._:-]{8,160}$/.test(value), 'EUROPE_PMC_REQUEST_ID_REQUIRED'); return value;};
const actorValue = value => {need(typeof value === 'string' && value.trim().length > 0 && value.length <= 200, 'EUROPE_PMC_ACTOR_REQUIRED'); return value;};
const integer = value => Number.isSafeInteger(value) && value >= 0;
const code = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,120}$/.test(error.code) ? error.code : 'EUROPE_PMC_OPERATION_FAILED';
const keyHash = value => sha256(Buffer.from(canonical(value)));
const phaseSet = new Set(['PREPARED','RUNNING','STOPPED','FAILED','READY']);
const sleep = (ms,signal) => new Promise((accept,reject) => {
  if (signal?.aborted) {reject(Object.assign(new Error('Stopped'),{code:'EUROPE_PMC_ACQUISITION_STOPPED'})); return;}
  const abort = () => {clearTimeout(timer); signal?.removeEventListener('abort',abort); reject(Object.assign(new Error('Stopped'),{code:'EUROPE_PMC_ACQUISITION_STOPPED'}));};
  const timer = setTimeout(() => {signal?.removeEventListener('abort',abort); accept();},ms);
  signal?.addEventListener('abort',abort,{once:true});
});
async function retain(path, bytes) {
  try {await writeBytes(path,bytes,{exclusive:true});}
  catch (error) {if (error.code !== 'EEXIST') throw error;
    const old = await readBytes(path, Math.max(bytes.length,1)); need(old.equals(bytes), 'EUROPE_PMC_RETAINED_BYTES_CHANGED');}
  return {bytes: bytes.length, sha256: sha256(bytes)};
}
const dateValue=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function checkLibrary(value) {
  need(object(value) && value.schema===LIBRARY && /^epw_[a-f0-9]{64}$/.test(value.id) && integer(value.revision) &&
    dateValue(value.createdAt) && object(value.queries) && object(value.reviews) && object(value.requests) &&
    Array.isArray(value.events) && value.events.length===value.revision &&
    Object.keys(value.requests).length===value.events.length,'EUROPE_PMC_WORKSPACE_CHANGED');
  const queries={}, reviews={}, seen=new Set();
  for(let index=0;index<value.events.length;index++) {
    const event=value.events[index], input=event?.input;
    need(object(event)&&object(input)&&event.revision===index+1&&dateValue(event.createdAt)&&
      requestId(event.requestId)&&actorValue(event.actor)&&event.requestId===input.requestId&&event.actor===input.actor&&
      !seen.has(event.requestId)&&keyHash({kind:event.kind,input})===event.fingerprint&&
      same(event,value.requests[event.requestId]),'EUROPE_PMC_WORKSPACE_EVENT_CHANGED');
    seen.add(event.requestId);
    if(event.kind==='query') {
      need(Object.keys(input).every(key=>['requestId','actor','id','expectedRevision','title','selection','sourceTerms'].includes(key))&&
        integer(input.expectedRevision)&&typeof input.title==='string'&&input.title.trim()&&input.title.length<=300,
        'EUROPE_PMC_QUERY_HISTORY_CHANGED');
      const queryId=input.id?id(input.id,'epq'):'epq_'+keyHash({requestId:input.requestId}), previous=queries[queryId],
        selection=searchSelection(input.selection),sourceTerms=input.sourceTerms??SOURCE_TERMS;
      need(typeof sourceTerms==='string'&&sourceTerms.trim()&&sourceTerms.length<=16000&&
        (previous?.revision??0)===input.expectedRevision&&dateValue(event.result?.createdAt),'EUROPE_PMC_QUERY_HISTORY_CHANGED');
      const body={id:queryId,revision:input.expectedRevision+1,title:input.title.trim(),selection,sourceTerms,
        actor:input.actor,createdAt:event.result.createdAt};
      const version={...body,sha256:keyHash(body),requestId:input.requestId};
      const result={...version,versions:[...(previous?.versions??[]),version]};
      need(same(result,event.result),'EUROPE_PMC_QUERY_HISTORY_CHANGED');queries[queryId]=result;
    } else if(event.kind==='record-review') {
      need(Object.keys(input).every(key=>['requestId','actor','operationId','editionSha256','recordKey','expectedRevision','decision','note'].includes(key))&&
        id(input.operationId,'epop')&&/^[a-f0-9]{64}$/.test(input.editionSha256)&&typeof input.recordKey==='string'&&
        ['include','exclude','uncertain','follow-up'].includes(input.decision)&&typeof input.note==='string'&&
        input.note.length<=2*1024*1024&&integer(input.expectedRevision),'EUROPE_PMC_REVIEW_HISTORY_CHANGED');
      const key=input.operationId+'\n'+input.recordKey, previous=reviews[key];
      need((previous?.revision??0)===input.expectedRevision&&dateValue(event.result?.createdAt),'EUROPE_PMC_REVIEW_HISTORY_CHANGED');
      const version={requestId:input.requestId,operationId:input.operationId,editionSha256:input.editionSha256,
        recordKey:input.recordKey,decision:input.decision,note:input.note,actor:input.actor,
        revision:input.expectedRevision+1,createdAt:event.result.createdAt};
      const result={...version,history:[...(previous?.history??[]),version]};
      need(same(result,event.result),'EUROPE_PMC_REVIEW_HISTORY_CHANGED');reviews[key]=result;
    } else need(false,'EUROPE_PMC_WORKSPACE_EVENT_KIND_INVALID');
  }
  need(same(queries,value.queries)&&same(reviews,value.reviews),'EUROPE_PMC_WORKSPACE_HISTORY_CHANGED');
  return value;
}
function checkPlan(value, operationId) {
  need(object(value)&&value.schema===PLAN&&value.id===operationId&&object(value.payload)&&dateValue(value.preparedAt)&&
    keyHash(value.payload)===value.sha256&&'epop_'+keyHash({requestId:value.payload.requestId})===operationId,
    'EUROPE_PMC_PLAN_CHANGED');
  const pagination=editionPagination(value.payload.pagination), parent=pagination.parent;
  const expected={requestId:value.payload.requestId,actor:value.payload.actor,queryId:value.payload.query?.id,
    queryRevision:value.payload.query?.revision,label:value.payload.label,mode:value.payload.mode};
  if(parent)expected.continuation={operationId:parent.operationId,expectedEditionSha256:parent.editionSha256,expectedPlanSha256:parent.planSha256};
  need(object(value.request)&&same(value.request,expected),'EUROPE_PMC_PLAN_CHANGED');
  const query=value.payload.query, {sha256:querySha,requestId:queryRequest,...queryBody}=query??{};
  need(typeof queryRequest==='string'&&keyHash(queryBody)===querySha,'EUROPE_PMC_QUERY_REVISION_CHANGED');
  need(object(query)&&id(query.id,'epq')&&integer(query.revision)&&query.revision>0&&
    ['live','documents'].includes(value.payload.mode)&&typeof value.payload.label==='string'&&value.payload.label.trim()&&
    value.payload.label.length<=300,'EUROPE_PMC_PLAN_CHANGED');
  need(same(searchSelection(query.selection),query.selection),'EUROPE_PMC_QUERY_SELECTION_CHANGED');
  actorValue(value.payload.actor);requestId(value.payload.requestId);
  return value;
}
function checkEditionPlan(value, selected) {
  need(same(value.metadata.selection,selected.payload.query.selection)&&
    same(value.metadata.pagination,selected.payload.pagination)&&value.metadata.label===selected.payload.label&&
    value.metadata.createdAt===selected.preparedAt&&value.sourceTerms===selected.payload.query.sourceTerms,
    'EUROPE_PMC_RETAINED_PLAN_BINDING_CHANGED');
}
function checkState(value, operationId) {
  need(object(value) && value.schema === OPERATION && value.id === operationId && phaseSet.has(value.phase) &&
    integer(value.sequence) && integer(value.attempts) && Array.isArray(value.failures), 'EUROPE_PMC_OPERATION_CHANGED'); return value;
}
function portableMember(name) {
  return name === 'library.json' || name === 'receiving.json' ||
    /^operations\/epop_[a-f0-9]{64}\/(?:plan\.json|state\.json|edition\.json|source-pages\/page-[0-9]{6}\.json|boundary-page\.json|failed-pages\/attempt-[0-9]{6}\.json|receipts\/[a-f0-9]{64}\.(?:request|receipt)\.json)$/.test(name);
}
export function validateEuropePmcPortable(bytes) {
  need(bytes instanceof Uint8Array && bytes.byteLength <= PORTABLE_LIMIT, 'EUROPE_PMC_PORTABLE_SIZE_EXCEEDED');
  const raw = Buffer.from(bytes);
  let decoded;
  try {decoded = raw[0] === 31 && raw[1] === 139 ? gunzipSync(raw,{maxOutputLength:PORTABLE_LIMIT}) : raw;}
  catch {throw Object.assign(new Error('Invalid portable archive'),{code:'EUROPE_PMC_PORTABLE_INVALID'});}
  need(decoded.length <= PORTABLE_LIMIT, 'EUROPE_PMC_PORTABLE_SIZE_EXCEEDED');
  const value = parseJson(decoded);
  need(object(value) && value.schema === PORTABLE && object(value.workspace) && Array.isArray(value.members) && value.members.length > 0,
    'EUROPE_PMC_PORTABLE_INVALID');
  const names = new Set(), files = new Map(); let total = 0;
  for (const member of value.members) {
    need(object(member) && portableMember(member.name) && !names.has(member.name) && integer(member.bytes) &&
      typeof member.base64 === 'string' && /^[a-f0-9]{64}$/.test(member.sha256), 'EUROPE_PMC_PORTABLE_MEMBER_INVALID');
    names.add(member.name);
    const body = Buffer.from(member.base64,'base64');
    need(body.toString('base64') === member.base64 && body.length === member.bytes && sha256(body) === member.sha256,
      'EUROPE_PMC_PORTABLE_MEMBER_CHANGED');
    total += body.length; need(total <= PORTABLE_LIMIT, 'EUROPE_PMC_PORTABLE_SIZE_EXCEEDED'); files.set(member.name,body);
  }
  need(files.has('library.json'), 'EUROPE_PMC_PORTABLE_LIBRARY_MISSING');
  const library = checkLibrary(parseJson(files.get('library.json')));
  need(library.id === value.workspace.id && library.revision === value.workspace.revision, 'EUROPE_PMC_PORTABLE_WORKSPACE_CHANGED');
  need(dateValue(value.createdAt)&&object(value.export)&&requestId(value.export.requestId)&&actorValue(value.export.actor),
    'EUROPE_PMC_PORTABLE_EXPORT_INVALID');
  const ids=[...new Set([...files.keys()].filter(name=>name.startsWith('operations/')).map(name=>name.split('/')[1]))], indexed=new Map();
  for(const operationId of ids) {
    const prefix='operations/'+operationId+'/';
    need(files.has(prefix+'plan.json')&&files.has(prefix+'state.json'),'EUROPE_PMC_PORTABLE_OPERATION_INCOMPLETE');
    const selected=checkPlan(parseJson(files.get(prefix+'plan.json')),operationId), state=checkState(parseJson(files.get(prefix+'state.json')),operationId);
    const query=library.queries[selected.payload.query.id]?.versions.find(row=>row.revision===selected.payload.query.revision);
    need(query&&same(query,selected.payload.query),'EUROPE_PMC_PORTABLE_QUERY_PLAN_CHANGED');
    const pageNames=[...files.keys()].filter(name=>name.startsWith(prefix+'source-pages/')).sort(),documents=[];
    let cursor=selected.payload.pagination.startCursorMark, terminal=false; const seen=new Set();
    for(let index=0;index<pageNames.length;index++) {
      need(pageNames[index]===prefix+'source-pages/page-'+String(index+1).padStart(6,'0')+'.json'&&!terminal&&!seen.has(cursor),
        'EUROPE_PMC_PORTABLE_CURSOR_CHANGED');seen.add(cursor);
      const document=parseJson(files.get(pageNames[index])),parsed=readSearchPage(document,query.selection,cursor);documents.push(document);
      terminal=parsed.records.length===0||!parsed.nextCursorMark||parsed.nextCursorMark===cursor;
      if(!terminal){need(!seen.has(parsed.nextCursorMark),'EUROPE_PMC_PORTABLE_CURSOR_CHANGED');cursor=parsed.nextCursorMark;}
    }
    need(integer(state.pages)&&state.pages<=documents.length,'EUROPE_PMC_PORTABLE_PAGE_STATE_CHANGED');
    let editionValue=null;
    if(files.has(prefix+'edition.json')) {
      const body=files.get(prefix+'edition.json');editionValue=validateEdition(parseJson(body));checkEditionPlan(editionValue,selected);
      need(same(editionValue.originalDocuments,documents),'EUROPE_PMC_PORTABLE_SOURCE_CHANGED');
      if(state.phase==='READY')need(body.length===state.editionBytes&&sha256(body)===state.editionSha256&&
        state.pages===documents.length&&same(state.coverage,editionValue.usage.coverage),'EUROPE_PMC_PORTABLE_EDITION_CHANGED');
    } else need(state.phase!=='READY','EUROPE_PMC_PORTABLE_EDITION_MISSING');
    let boundary=null;
    if(files.has(prefix+'boundary-page.json')) {
      need(!terminal,'EUROPE_PMC_PORTABLE_BOUNDARY_CHANGED');boundary=parseJson(files.get(prefix+'boundary-page.json'));
      readSearchPage(boundary,query.selection,cursor);
      if(editionValue)need(editionValue.usage.coverage.stopReason==='byte-limit','EUROPE_PMC_PORTABLE_BOUNDARY_CHANGED');
    }
    for(const [name,body] of files) if(name.startsWith(prefix+'failed-pages/'))validateDocument(parseJson(body));
    indexed.set(operationId,{plan:selected,state,edition:editionValue,documents,boundary,cursor,terminal});
  }
  for(const [operationId,entry] of indexed) {
    const parent=entry.plan.payload.pagination.parent;
    if(parent) {
      const original=indexed.get(parent.operationId);
      need(original?.state.phase==='READY'&&original.edition&&original.state.editionSha256===parent.editionSha256&&
        original.plan.sha256===parent.planSha256&&same(original.plan.payload.query,entry.plan.payload.query)&&
        original.plan.payload.mode===entry.plan.payload.mode&&!original.edition.usage.coverage.terminal&&
        original.edition.usage.coverage.nextCursorMark===parent.cursorMark&&
        (original.boundary?.documentId??null)===parent.boundaryDocumentId,'EUROPE_PMC_PORTABLE_CONTINUATION_CHANGED');
      if(parent.boundaryDocumentId&&entry.documents.length)need(same(entry.documents[0],original.boundary),
        'EUROPE_PMC_PORTABLE_BOUNDARY_SOURCE_CHANGED');
      const ancestors=new Set([operationId]);let ancestor=original;
      while(ancestor){need(!ancestors.has(ancestor.plan.id),'EUROPE_PMC_PORTABLE_CONTINUATION_CYCLE');ancestors.add(ancestor.plan.id);
        const next=ancestor.plan.payload.pagination.parent;ancestor=next?indexed.get(next.operationId):null;
        need(!next||ancestor,'EUROPE_PMC_PORTABLE_CONTINUATION_MISSING');}
    }
    const prefix='operations/'+operationId+'/receipts/';
    for(const [name,body] of files) if(name.startsWith(prefix)) {
      if(name.endsWith('.receipt.json'))continue;
      const saved=parseJson(body),input=saved?.request;
      need(object(input)&&dateValue(saved.createdAt)&&keyHash(input)===saved.fingerprint&&
        name===prefix+keyHash(requestId(input.requestId))+'.request.json'&&actorValue(input.actor)&&
        entry.state.phase==='READY'&&input.expectedPlanSha256===entry.plan.sha256&&
        input.expectedEditionSha256===entry.state.editionSha256&&integer(input.expectedRevision)&&
        typeof input.dossierId==='string'&&typeof input.questionId==='string'&&typeof input.label==='string',
        'EUROPE_PMC_PORTABLE_RECEIVE_REQUEST_CHANGED');
      const receiptName=name.replace(/\.request\.json$/,'.receipt.json');
      if(files.has(receiptName)) {
        const receipt=parseJson(files.get(receiptName)),editionId='e_'+sha256(Buffer.from(input.questionId+'\n'+'europe-pmc'+'\n'+
          entry.state.editionSha256+'\n'+'epmc-receive:'+input.requestId));
        const expected={schema:'stellar-forge.europe-pmc-receipt.v1',fingerprint:saved.fingerprint,requestId:input.requestId,
          operationId,dossierId:input.dossierId,questionId:input.questionId,editionId,sourceSha256:entry.state.editionSha256,
          sourceBytes:entry.state.editionBytes,originalRevision:input.expectedRevision,revision:input.expectedRevision+1,
          receivedAt:saved.createdAt,coverage:entry.edition.usage.coverage,records:entry.edition.results.length};
        need(same(receipt,expected),'EUROPE_PMC_PORTABLE_RECEIPT_CHANGED');
      }
    }
    for(const name of files.keys())if(name.startsWith(prefix)&&name.endsWith('.receipt.json'))
      need(files.has(name.replace(/\.receipt\.json$/,'.request.json')),'EUROPE_PMC_PORTABLE_RECEIVE_REQUEST_MISSING');
  }
  for(const review of Object.values(library.reviews)) {
    const entry=indexed.get(review.operationId);
    need(entry?.state.phase==='READY'&&entry.state.editionSha256===review.editionSha256&&
      entry.edition.results.some(row=>row.id===review.recordKey),'EUROPE_PMC_PORTABLE_REVIEW_SOURCE_CHANGED');
    for(const version of review.history)need(version.editionSha256===entry.state.editionSha256,'EUROPE_PMC_PORTABLE_REVIEW_SOURCE_CHANGED');
  }
  return {value, files, library, archiveSha256:sha256(raw), archiveBytes:raw.length};
}
export async function restoreEuropePmcWorkspace({bytes,directory}) {
  const selected=validateEuropePmcPortable(bytes);directory=resolve(directory);
  const parent=await privateDirectory(dirname(directory),{create:false});
  const identity={schema:'stellar-forge.europe-pmc-receiving.v1',archiveSha256:selected.archiveSha256,
    archiveBytes:selected.archiveBytes,workspaceId:selected.library.id};
  const selectionName='epmc-receive-'+keyHash(basename(directory)),claimPath=join(parent,selectionName+'.json');
  return withPrivateLock(parent,selectionName+'.lock',async()=>{
    let claim;
    if(await exists(claimPath)) {
      claim=await readJson(claimPath,32768);
      need(claim.directory===directory&&same(claim.identity,identity)&&dateValue(claim.preparedAt),
        'EUROPE_PMC_RECEIVING_SELECTION_CHANGED');
    } else {
      need(!await exists(directory),'EUROPE_PMC_RECEIVING_TARGET_EXISTS');
      claim={schema:'stellar-forge.europe-pmc-receiving-selection.v1',directory,identity,preparedAt:stamp()};
      // The create-only selection precedes directory creation. An empty target
      // left before its inner marker is therefore owned by this exact request.
      await retain(claimPath,jsonBytes(claim));
    }
    try{await mkdir(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    await privateDirectory(directory,{create:false});
    const marker=join(directory,'restore-selection.json');
    if(await exists(marker))need(same(await readJson(marker,32768),identity),'EUROPE_PMC_RECEIVING_SELECTION_CHANGED');
    else {
      need((await readdir(directory)).length===0,'EUROPE_PMC_RECEIVING_TARGET_EXISTS');
      await retain(marker,jsonBytes(identity));
    }
    for(const [name,body] of selected.files) {
      if(name==='receiving.json')continue;
      const pieces=name.split('/');let target=directory;
      for(const component of pieces.slice(0,-1))target=await privateDirectory(join(target,component));
      await retain(join(target,pieces.at(-1)),body);
    }
    const received={...identity,receivedAt:claim.preparedAt,
      previousReceiving:selected.files.has('receiving.json')?parseJson(selected.files.get('receiving.json')):null};
    await retain(join(directory,'receiving.json'),jsonBytes(received));
    return {workspaceId:selected.library.id,revision:selected.library.revision,archiveSha256:selected.archiveSha256,
      archiveBytes:selected.archiveBytes,members:selected.files.size,directory,receiving:received};
  });
}
export async function openEuropePmcWorkspace({directory,dossiers,fetchImpl=globalThis.fetch,requestIntervalMs=1000,rateDirectory=null}={}) {
  need(dossiers && typeof dossiers.receive === 'function' && typeof dossiers.get === 'function', 'DOSSIER_STORE_REQUIRED');
  need(Number.isInteger(requestIntervalMs) && requestIntervalMs >= 125 && requestIntervalMs <= 60000, 'EUROPE_PMC_REQUEST_INTERVAL_INVALID');
  directory = await privateDirectory(resolve(directory));
  const operations = await privateDirectory(join(directory,'operations')), exportsRoot = await privateDirectory(join(directory,'exports'));
  const providerRate = await privateDirectory(rateDirectory ? resolve(rateDirectory) : join(directory,'provider-rate'));
  const active = new Map(), tasks = new Set(); let closed = false, serial = Promise.resolve();
  const rootFile = join(directory,'library.json');
  try {await readJson(rootFile,CONTROL_LIMIT);} catch (error) {if (error.code !== 'ENOENT') throw error;
    await withPrivateLock(directory,'workspace.lock',async() => {
      if (!await exists(rootFile)) await writeJson(rootFile,{schema:LIBRARY,id:'epw_'+keyHash(randomUUID()),revision:0,
        createdAt:stamp(),queries:{},reviews:{},requests:{},events:[]},{exclusive:true});
    });}
  const library = async() => checkLibrary(await readJson(rootFile,CONTROL_LIMIT));
  const folder = operationId => join(operations,id(operationId,'epop'));
  const plan = async operationId => checkPlan(await readJson(join(folder(operationId),'plan.json'),CONTROL_LIMIT),operationId);
  function initialState(selected) {return {schema:OPERATION,id:selected.id,phase:'PREPARED',sequence:0,attempts:0,pages:0,
    startedAt:null,updatedAt:selected.preparedAt,error:null,failures:[],cooldownUntil:null,coverage:null,editionSha256:null,editionBytes:null};}
  const state = async operationId => {
    try{return checkState(await readJson(join(folder(operationId),'state.json'),CONTROL_LIMIT),operationId);}
    catch(error){if(error.code!=='ENOENT')throw error;return initialState(await plan(operationId));}
  };
  async function rateRecord() {
    try{const value=await readJson(join(providerRate,'rate.json'),32768);
      need(value.schema==='stellar-forge.europe-pmc-public-rate.v1'&&integer(value.lastDispatchAt)&&integer(value.cooldownUntil),'EUROPE_PMC_RATE_STATE_CHANGED');return value;}
    catch(error){if(error.code!=='ENOENT')throw error;return {schema:'stellar-forge.europe-pmc-public-rate.v1',lastDispatchAt:0,cooldownUntil:0};}
  }
  async function reserveSource(signal) {
    return withPrivateLock(providerRate,'rate.lock',async()=>{
      const current=await rateRecord();
      need(current.cooldownUntil<=Date.now(),'EUROPE_PMC_PROVIDER_COOLDOWN',{until:new Date(current.cooldownUntil).toISOString()});
      const wait=Math.max(0,current.lastDispatchAt+requestIntervalMs-Date.now());if(wait)await sleep(wait,signal);
      need(!signal.aborted,'EUROPE_PMC_ACQUISITION_STOPPED');
      await writeJson(join(providerRate,'rate.json'),{...current,lastDispatchAt:Date.now()});
    });
  }
  async function sourceCooldown(until) {
    if(!until)return;
    return withPrivateLock(providerRate,'rate.lock',async()=>{
      const current=await rateRecord();await writeJson(join(providerRate,'rate.json'),{...current,cooldownUntil:Math.max(current.cooldownUntil,Date.parse(until))});
    });
  }
  const metadata = (dossierId,options) => typeof dossiers.getMetadata === 'function' ? dossiers.getMetadata(dossierId,options) : dossiers.get(dossierId,options);
  function tracked(work) {need(!closed,'EUROPE_PMC_WORKSPACE_CLOSED'); const promise = Promise.resolve().then(work);
    tasks.add(promise); promise.finally(()=>tasks.delete(promise)).catch(()=>{}); return promise;}
  function transact(work) {
    const result = serial.then(()=>withPrivateLock(directory,'workspace.lock',async()=>work(await library())));
    serial = result.catch(()=>{}); return result;
  }
  async function mutate(kind,input,work) {
    requestId(input.requestId); actorValue(input.actor); const fingerprint = keyHash({kind,input});
    return transact(async current => {
      const previous = current.requests[input.requestId];
      if (previous) {need(previous.kind===kind && previous.fingerprint===fingerprint,'EUROPE_PMC_REQUEST_ID_REUSED'); return previous.result;}
      const next = structuredClone(current), result = await work(next);
      next.revision++; const event = {requestId:input.requestId,kind,fingerprint,input:structuredClone(input),actor:input.actor,createdAt:stamp(),revision:next.revision,result};
      next.requests[input.requestId] = event; next.events.push(event);
      const bytes=jsonBytes(next); need(bytes.length<=CONTROL_LIMIT,'EUROPE_PMC_WORKSPACE_METADATA_LIMIT');
      await writeBytes(rootFile,bytes); return result;
    });
  }
  async function saveState(operationId,value) {
    const next={...value,sequence:value.sequence+1,updatedAt:stamp()};
    checkState(next,operationId); await writeJson(join(folder(operationId),'state.json'),next); return next;
  }
  async function sourcePages(operationId) {
    const path=join(folder(operationId),'source-pages'), names=(await readdir(path)).filter(name=>/^page-[0-9]{6}\.json$/.test(name)).sort();
    const pages=[];
    for(let index=0;index<names.length;index++) {
      need(names[index]==='page-'+String(index+1).padStart(6,'0')+'.json','EUROPE_PMC_RETAINED_PAGE_GAP');
      const document=await readJson(join(path,names[index]),Math.ceil(MAX_PAGE_BYTES*1.4)+65536); validateDocument(document); pages.push(document);
    }
    return pages;
  }
  async function boundaryPage(operationId) {
    try{const document=await readJson(join(folder(operationId),'boundary-page.json'),Math.ceil(MAX_PAGE_BYTES*1.4)+65536);
      validateDocument(document);return document;}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async function continuationSource(selected) {
    const parent=selected.payload.pagination.parent;if(!parent)return null;
    const original=await edition(parent.operationId);
    need(original.operation.editionSha256===parent.editionSha256&&original.plan.sha256===parent.planSha256&&
      same(original.plan.payload.query,selected.payload.query)&&original.value.usage.coverage.nextCursorMark===parent.cursorMark&&
      !original.value.usage.coverage.terminal,'EUROPE_PMC_CONTINUATION_SOURCE_CHANGED');
    const boundary=await boundaryPage(parent.operationId);
    need((boundary?.documentId??null)===parent.boundaryDocumentId,'EUROPE_PMC_CONTINUATION_BOUNDARY_CHANGED');
    if(boundary)readSearchPage(boundary,selected.payload.query.selection,parent.cursorMark);
    return boundary;
  }
  async function continueSearch(operationId,input) {
    need(object(input)&&Object.keys(input).every(key=>['requestId','actor','label','expectedEditionSha256','expectedPlanSha256'].includes(key)),
      'EUROPE_PMC_CONTINUATION_INPUT_INVALID');
    const original=await edition(operationId);
    return prepare({requestId:input.requestId,actor:input.actor,queryId:original.plan.payload.query.id,
      queryRevision:original.plan.payload.query.revision,label:input.label,mode:original.plan.payload.mode,
      continuation:{operationId,expectedEditionSha256:input.expectedEditionSha256,expectedPlanSha256:input.expectedPlanSha256}});
  }
  async function chain(operationId) {
    const parts=[],seen=new Set();let selected=await edition(operationId);
    while(selected) {
      need(!seen.has(selected.plan.id),'EUROPE_PMC_CONTINUATION_CYCLE');seen.add(selected.plan.id);parts.unshift(selected);
      const parent=selected.plan.payload.pagination.parent;
      if(!parent)break;
      await continuationSource(selected.plan);selected=await edition(parent.operationId);
    }
    const keys=new Set(),totals=new Set(),issues=[],recordHashes=new Map();
    for(const part of parts) {
      for(const row of part.value.results){keys.add(row.id);const hashes=recordHashes.get(row.id)??new Set();
        for(const variant of row.metadata.variants)hashes.add(variant.recordSha256);recordHashes.set(row.id,hashes);}
      for(const total of part.value.usage.coverage.reportedTotals)totals.add(total);
      issues.push(...part.value.usage.coverage.issues.filter(issue=>issue.code!=='CONTINUATION_PART'&&issue.code!=='REPEATED_NATIVE_RECORDS'));
    }
    for(const [recordKey,hashes]of recordHashes)if(hashes.size>1)issues.push({code:'NATIVE_RECORD_CHANGED_ACROSS_PARTS',recordKey,recordSha256:[...hashes].sort()});
    const terminal=parts.at(-1).value.usage.coverage.terminal;
    const complete=terminal&&totals.size===1&&[...totals][0]===keys.size&&issues.length===0;
    return {schema:'stellar-forge.europe-pmc-continuation-chain.v1',complete,terminal,uniqueRecords:keys.size,
      reportedTotals:[...totals],issues,parts:parts.map(part=>({operationId:part.plan.id,planSha256:part.plan.sha256,
        editionSha256:part.operation.editionSha256,label:part.plan.payload.label,coverage:part.value.usage.coverage}))};
  }
  async function writeEdition(operationId,selected,current,documents,stopReason=null) {
    const value=buildEdition({selection:selected.payload.query.selection,documents,label:selected.payload.label,
      createdAt:selected.preparedAt,sourceTerms:selected.payload.query.sourceTerms,pagination:selected.payload.pagination,stopReason});
    const bytes=jsonBytes(value), retained=await retain(join(folder(operationId),'edition.json'),bytes);
    current=await saveState(operationId,{...current,phase:'READY',editionSha256:retained.sha256,editionBytes:retained.bytes,
      coverage:value.usage.coverage,error:null,pages:documents.length});
    return {plan:selected,operation:current};
  }
  async function edition(operationId) {
    const [selected,current]=await Promise.all([plan(operationId),state(operationId)]);
    need(current.phase==='READY','EUROPE_PMC_EDITION_NOT_READY');
    const bytes=await readBytes(join(folder(operationId),'edition.json'),MAX_EDITION_BYTES);
    need(bytes.length===current.editionBytes&&sha256(bytes)===current.editionSha256,'EUROPE_PMC_RETAINED_EDITION_CHANGED');
    const value=validateEdition(parseJson(bytes)); checkEditionPlan(value,selected);
    return {bytes,value,plan:selected,operation:current};
  }
  async function isRunning(operationId) {
    if(active.has(operationId))return true;
    try{await withPrivateLock(folder(operationId),'operation.lock',async()=>{});return false;}
    catch(error){if(error.code==='ROUTESCAN_RECORD_BUSY')return true;throw error;}
  }
  async function inspect(operationId) {
    const [selected,current]=await Promise.all([plan(operationId),state(operationId)]);
    const running=current.phase==='RUNNING'&&await isRunning(operationId);
    const receipts=[];
    for(const name of (await readdir(join(folder(operationId),'receipts'))).filter(name=>name.endsWith('.receipt.json')).sort())
      receipts.push(await readJson(join(folder(operationId),'receipts',name),1024*1024));
    const boundary=await boundaryPage(operationId);
    return {plan:selected,operation:current,running,interrupted:current.phase==='RUNNING'&&!running,receipts,
      boundary:boundary?{documentId:boundary.documentId,bodySha256:boundary.bodySha256,bodyBytes:boundary.bodyBytes,url:boundary.url}:null};
  }
  async function operationIds() {
    const result=[];
    for(const name of (await readdir(operations)).filter(name=>/^epop_[a-f0-9]{64}$/.test(name)).sort())
      if(await exists(join(operations,name,'plan.json')))result.push(name);
    return result;
  }
  async function query(queryId) {const current=await library();const value=current.queries[id(queryId,'epq')];need(value,'EUROPE_PMC_QUERY_NOT_FOUND');return value;}
  async function saveQuery(input) {
    need(object(input)&&Object.keys(input).every(key=>['requestId','actor','id','expectedRevision','title','selection','sourceTerms'].includes(key)),
      'EUROPE_PMC_QUERY_FIELDS_INVALID');
    need(typeof input.title==='string'&&input.title.trim()&&input.title.length<=300&&integer(input.expectedRevision),'EUROPE_PMC_QUERY_INPUT_INVALID');
    const selection=searchSelection(input.selection), sourceTerms=input.sourceTerms??SOURCE_TERMS;
    need(typeof sourceTerms==='string'&&sourceTerms.trim()&&sourceTerms.length<=16000,'EUROPE_PMC_SOURCE_TERMS_REQUIRED');
    return mutate('query',input,async current=>{
      const queryId=input.id?id(input.id,'epq'):'epq_'+keyHash({requestId:input.requestId}), previous=current.queries[queryId];
      need((previous?.revision??0)===input.expectedRevision,'EUROPE_PMC_QUERY_REVISION_CONFLICT');
      const value={id:queryId,revision:input.expectedRevision+1,title:input.title.trim(),selection,sourceTerms,actor:input.actor,createdAt:stamp()};
      const revision={...value,sha256:keyHash(value),requestId:input.requestId};
      current.queries[queryId]={...revision,versions:[...(previous?.versions??[]),revision]};return current.queries[queryId];
    });
  }
  async function prepare(input) {
    need(object(input)&&Object.keys(input).every(key=>['requestId','actor','queryId','queryRevision','label','mode','continuation'].includes(key)),
      'EUROPE_PMC_PLAN_FIELDS_INVALID');
    requestId(input.requestId);actorValue(input.actor);id(input.queryId,'epq');
    need(integer(input.queryRevision)&&input.queryRevision>0&&['live','documents'].includes(input.mode),'EUROPE_PMC_PLAN_INPUT_INVALID');
    need(typeof input.label==='string'&&input.label.trim()&&input.label.length<=300,'EUROPE_PMC_LABEL_REQUIRED');
    const operationId='epop_'+keyHash({requestId:input.requestId}), path=await privateDirectory(folder(operationId));
    return withPrivateLock(path,'operation.lock',async()=>{
      if(await exists(join(path,'plan.json'))) {
        const existing=await plan(operationId);need(same(existing.request,input),'EUROPE_PMC_REQUEST_ID_REUSED');
        return {plan:existing,operation:await state(operationId)};
      }
      const current=await query(input.queryId), selected=current.versions.find(row=>row.revision===input.queryRevision);
      need(selected,'EUROPE_PMC_QUERY_REVISION_NOT_FOUND');
      let pagination={startCursorMark:'*',parent:null};
      if(input.continuation) {
        need(object(input.continuation)&&Object.keys(input.continuation).sort().join(',')==='expectedEditionSha256,expectedPlanSha256,operationId',
          'EUROPE_PMC_CONTINUATION_INPUT_INVALID');
        const original=await edition(input.continuation.operationId),coverage=original.value.usage.coverage;
        need(original.operation.editionSha256===input.continuation.expectedEditionSha256&&original.plan.sha256===input.continuation.expectedPlanSha256&&
          same(selected,original.plan.payload.query)&&input.mode===original.plan.payload.mode&&!coverage.terminal&&coverage.nextCursorMark,
          'EUROPE_PMC_CONTINUATION_SOURCE_CHANGED');
        const boundary=await boundaryPage(original.plan.id);
        pagination={startCursorMark:coverage.nextCursorMark,parent:{operationId:original.plan.id,
          editionSha256:original.operation.editionSha256,planSha256:original.plan.sha256,cursorMark:coverage.nextCursorMark,
          boundaryDocumentId:boundary?.documentId??null}};
      }
      const payload={requestId:input.requestId,actor:input.actor,query:selected,label:input.label,mode:input.mode,pagination};
      const selectedPlan={schema:PLAN,id:operationId,request:input,payload,sha256:keyHash(payload),preparedAt:stamp()};
      for(const name of ['source-pages','failed-pages','receipts'])await privateDirectory(join(path,name));
      await writeJson(join(path,'plan.json'),selectedPlan,{exclusive:true});
      const currentState=initialState(selectedPlan);
      await writeJson(join(path,'state.json'),currentState,{exclusive:true});
      return {plan:selectedPlan,operation:currentState};
    });
  }
  async function importDocuments(operationId,input) {
    need(object(input)&&Object.keys(input).every(key=>['expectedPlanSha256','documents','pages','stopReason'].includes(key)),'EUROPE_PMC_IMPORT_FIELDS_INVALID');
    return withPrivateLock(folder(operationId),'operation.lock',async()=>{
      const selected=await plan(operationId), current=await state(operationId);
      need(selected.sha256===input.expectedPlanSha256&&selected.payload.mode==='documents','EUROPE_PMC_PLAN_CHANGED');
      need((input.documents===undefined)!==(input.pages===undefined),'EUROPE_PMC_ORIGINAL_IMPORT_REQUIRED');
      if(input.pages!==undefined) {
        need(Array.isArray(input.pages),'EUROPE_PMC_ORIGINAL_IMPORT_REQUIRED');
        input={...input,documents:input.pages.map(page=>{
          need(object(page)&&typeof page.bodyBase64==='string'&&typeof page.retainedAt==='string','EUROPE_PMC_ORIGINAL_IMPORT_REQUIRED');
          const bytes=Buffer.from(page.bodyBase64,'base64');need(bytes.toString('base64')===page.bodyBase64,'EUROPE_PMC_BASE64_INVALID');
          return sourceDocument({url:page.url,bytes,kind:'retained-document',
            observation:{status:null,headers:null,retrievedAt:null,retainedAt:page.retainedAt},provenance:page.provenance??{}});
        })};
      }
      const inherited=await continuationSource(selected);
      if(inherited&&!same(input.documents[0],inherited))input={...input,documents:[inherited,...input.documents]};
      const value=buildEdition({selection:selected.payload.query.selection,documents:input.documents,label:selected.payload.label,
        createdAt:selected.preparedAt,sourceTerms:selected.payload.query.sourceTerms,pagination:selected.payload.pagination,stopReason:input.stopReason??null});
      if(current.phase==='READY') {
        const saved=await edition(operationId);need(same(saved.value,value),'EUROPE_PMC_IMPORTED_EDITION_CHANGED');return inspect(operationId);
      }
      for(let index=0;index<input.documents.length;index++)
        await retain(join(folder(operationId),'source-pages','page-'+String(index+1).padStart(6,'0')+'.json'),jsonBytes(input.documents[index]));
      const retained=await sourcePages(operationId);need(retained.length===input.documents.length,'EUROPE_PMC_IMPORT_SOURCE_SELECTION_CHANGED');
      return writeEdition(operationId,selected,current,retained,input.stopReason??null);
    });
  }
  async function collect(operationId,selected,controller,ready) {
    return withPrivateLock(folder(operationId),'operation.lock',async()=>{
      let current=await state(operationId);if(current.phase==='READY'){ready();return;}
      need(selected.payload.mode==='live','EUROPE_PMC_LIVE_PLAN_REQUIRED');
      need(!current.cooldownUntil||Date.parse(current.cooldownUntil)<=Date.now(),'EUROPE_PMC_PROVIDER_COOLDOWN',{until:current.cooldownUntil});
      current=await saveState(operationId,{...current,phase:'RUNNING',attempts:current.attempts+1,
        startedAt:current.startedAt??stamp(),error:null});ready();
      try {
        const documents=await sourcePages(operationId),selection=selected.payload.query.selection,seen=new Set();
        const inherited=await continuationSource(selected);
        let cursor=selected.payload.pagination.startCursorMark,terminal=false,rawBytes=0,
          estimatedBytes=32768+16*jsonBytes({selection,label:selected.payload.label,createdAt:selected.preparedAt,
            sourceTerms:selected.payload.query.sourceTerms,pagination:selected.payload.pagination}).length;
        for(const document of documents) {
          need(!terminal&&!seen.has(cursor),'EUROPE_PMC_RETAINED_CURSOR_CHANGED');seen.add(cursor);
          const parsed=readSearchPage(document,selection,cursor);rawBytes+=document.bodyBytes;
          estimatedBytes+=estimatePageBytes(parsed,seen.size-1);
          terminal=parsed.records.length===0||!parsed.nextCursorMark||parsed.nextCursorMark===cursor;
          if(!terminal)cursor=parsed.nextCursorMark;
        }
        if(inherited&&documents.length)need(same(inherited,documents[0]),'EUROPE_PMC_CONTINUATION_BOUNDARY_CHANGED');
        const boundary=await boundaryPage(operationId);
        if(boundary) {
          readSearchPage(boundary,selection,cursor);
          need(documents.length>0,'EUROPE_PMC_SINGLE_PAGE_EXCEEDS_EDITION_BUDGET');
          await writeEdition(operationId,selected,current,documents,'byte-limit');return;
        }
        while(!terminal&&documents.length<selection.maxPages) {
          need(!controller.signal.aborted,'EUROPE_PMC_ACQUISITION_STOPPED');
          if(rawBytes>=MAX_RAW_BYTES){await writeEdition(operationId,selected,current,documents,'byte-limit');return;}
          let document;
          if(documents.length===0&&inherited)document=inherited;
          else {await reserveSource(controller.signal);document=await fetchSearchDocument(selection,cursor,{signal:controller.signal,fetchImpl});}
          let parsed;
          try{parsed=readSearchPage(document,selection,cursor);}
          catch(error) {
            await retain(join(folder(operationId),'failed-pages','attempt-'+String(current.attempts).padStart(6,'0')+'.json'),jsonBytes(document));
            const status=document.observation.status,retry=document.observation.headers?.['retry-after'];let until=null;
            if([429,503].includes(status)) {
              const candidate=/^[0-9]+$/.test(retry??'')?Date.now()+Number(retry)*1000:Date.parse(retry);
              until=new Date(Number.isFinite(candidate)&&candidate>Date.now()?candidate:Date.now()+60000).toISOString();
            }
            await sourceCooldown(until);
            current=await saveState(operationId,{...current,cooldownUntil:until,failures:[...current.failures,{
              attempt:current.attempts,documentId:document.documentId,status,code:code(error),
              observedAt:document.observation.retrievedAt??document.observation.retainedAt}]});
            throw error;
          }
          const contribution=estimatePageBytes(parsed,documents.length);
          if(rawBytes+document.bodyBytes>MAX_RAW_BYTES||estimatedBytes+contribution>MAX_EDITION_BYTES) {
            if(documents.length===0) {
              // A single unusually formatted page may exceed the conservative
              // bound yet fit the exact edition. Evaluate this one page once.
              try{buildEdition({selection,documents:[document],label:selected.payload.label,createdAt:selected.preparedAt,
                sourceTerms:selected.payload.query.sourceTerms,pagination:selected.payload.pagination,stopReason:'byte-limit'});}
              catch(error){if(!['EUROPE_PMC_RAW_SOURCE_BUDGET_EXCEEDED','EUROPE_PMC_EDITION_SIZE_EXCEEDED'].includes(error.code))throw error;
                await retain(join(folder(operationId),'boundary-page.json'),jsonBytes(document));
                need(false,'EUROPE_PMC_SINGLE_PAGE_EXCEEDS_EDITION_BUDGET');}
            } else {
              await retain(join(folder(operationId),'boundary-page.json'),jsonBytes(document));
              await writeEdition(operationId,selected,current,documents,'byte-limit');return;
            }
          }
          estimatedBytes+=contribution;
          await retain(join(folder(operationId),'source-pages','page-'+String(documents.length+1).padStart(6,'0')+'.json'),jsonBytes(document));
          documents.push(document);rawBytes+=document.bodyBytes;
          current=await saveState(operationId,{...current,pages:documents.length,lastSource:{documentId:document.documentId,url:document.url,
            bodyBytes:document.bodyBytes,bodySha256:document.bodySha256,status:document.observation.status},cooldownUntil:null});
          seen.add(cursor);terminal=parsed.records.length===0||!parsed.nextCursorMark||parsed.nextCursorMark===cursor;
          if(!terminal){need(!seen.has(parsed.nextCursorMark),'EUROPE_PMC_CURSOR_CYCLE');cursor=parsed.nextCursorMark;}
        }
        await writeEdition(operationId,selected,current,documents,terminal?null:'page-limit');
      }catch(error) {
        await saveState(operationId,{...current,phase:controller.signal.aborted?'STOPPED':'FAILED',error:code(error)});
      }
    });
  }
  async function seal(operationId,{expectedPlanSha256}) {
    return withPrivateLock(folder(operationId),'operation.lock',async()=>{
      const selected=await plan(operationId),current=await state(operationId);
      need(selected.sha256===expectedPlanSha256,'EUROPE_PMC_PLAN_CHANGED');
      if(current.phase==='READY')return inspect(operationId);
      const documents=await sourcePages(operationId);need(documents.length>0,'EUROPE_PMC_SOURCE_PAGES_REQUIRED');
      return writeEdition(operationId,selected,current,documents,(await boundaryPage(operationId))?'byte-limit':'operator-stop');
    });
  }
  async function start(operationId,{expectedPlanSha256}) {
    const selected=await plan(operationId);need(selected.sha256===expectedPlanSha256,'EUROPE_PMC_PLAN_CHANGED');
    if(active.has(operationId))return inspect(operationId);
    const current=await state(operationId);if(current.phase==='READY')return inspect(operationId);
    let accept,reject;const ready=new Promise((a,b)=>{accept=a;reject=b;});
    const entry={controller:new AbortController(),promise:null};active.set(operationId,entry);
    entry.promise=collect(operationId,selected,entry.controller,accept).catch(error=>{reject(error);throw error;}).finally(()=>active.delete(operationId));
    entry.promise.catch(()=>{});await ready;return inspect(operationId);
  }
  async function stop(operationId) {
    await plan(operationId);const entry=active.get(operationId);
    if(entry){entry.controller.abort();await entry.promise;}
    else need(!await isRunning(operationId),'EUROPE_PMC_OPERATION_RUNNING_ELSEWHERE');
    return inspect(operationId);
  }
  async function records(operationId,{offset=0,limit=30,search='',key=null}={}) {
    need(integer(offset)&&Number.isInteger(limit)&&limit>=1&&limit<=100&&typeof search==='string'&&search.length<=2000,'EUROPE_PMC_PAGE_INVALID');
    const selected=await edition(operationId), current=await library();
    const items=selected.value.results.filter(row=>key?row.id===key:!search||canonical(row).toLowerCase().includes(search.toLowerCase()));
    return {operationId,editionSha256:selected.operation.editionSha256,coverage:selected.value.usage.coverage,total:items.length,
      items:items.slice(offset,offset+limit).map(row=>({...row,review:current.reviews[operationId+'\n'+row.id]??null})),
      nextOffset:offset+limit<items.length?offset+limit:null};
  }
  async function reviewRecord(input) {
    need(object(input)&&Object.keys(input).every(key=>['requestId','actor','operationId','editionSha256','recordKey','expectedRevision','decision','note'].includes(key)),
      'EUROPE_PMC_REVIEW_FIELDS_INVALID');
    need(['include','exclude','uncertain','follow-up'].includes(input.decision)&&typeof input.note==='string'&&input.note.length<=2*1024*1024&&integer(input.expectedRevision),
      'EUROPE_PMC_REVIEW_INPUT_INVALID');
    const selected=await edition(input.operationId);
    need(selected.operation.editionSha256===input.editionSha256&&selected.value.results.some(row=>row.id===input.recordKey),'EUROPE_PMC_REVIEW_SOURCE_CHANGED');
    return mutate('record-review',input,async current=>{
      const key=input.operationId+'\n'+input.recordKey, old=current.reviews[key];
      need((old?.revision??0)===input.expectedRevision,'EUROPE_PMC_REVIEW_REVISION_CONFLICT');
      const next={requestId:input.requestId,operationId:input.operationId,editionSha256:input.editionSha256,recordKey:input.recordKey,
        decision:input.decision,note:input.note,actor:input.actor,revision:input.expectedRevision+1,createdAt:stamp()};
      current.reviews[key]={...next,history:[...(old?.history??[]),next]};return current.reviews[key];
    });
  }
  async function receive(operationId,input) {
    need(object(input)&&Object.keys(input).every(key=>['requestId','actor','dossierId','questionId','label','expectedRevision','expectedPlanSha256','expectedEditionSha256'].includes(key)),
      'EUROPE_PMC_RECEIVE_FIELDS_INVALID');
    requestId(input.requestId);actorValue(input.actor);
    need(typeof input.dossierId==='string'&&typeof input.questionId==='string'&&typeof input.label==='string'&&input.label.trim()&&input.label.length<=300&&integer(input.expectedRevision),
      'EUROPE_PMC_RECEIVE_INPUT_INVALID');
    return withPrivateLock(folder(operationId),'operation.lock',async()=>{
      const selected=await edition(operationId), fingerprint=keyHash(input);
      need(selected.plan.sha256===input.expectedPlanSha256&&selected.operation.editionSha256===input.expectedEditionSha256,'EUROPE_PMC_RECEIVE_SOURCE_CHANGED');
      const receiptRoot=join(folder(operationId),'receipts'), name=keyHash(input.requestId),
        requestPath=join(receiptRoot,name+'.request.json'), receiptPath=join(receiptRoot,name+'.receipt.json');
      let saved;
      try{saved=await readJson(requestPath,1024*1024);need(saved.fingerprint===fingerprint,'EUROPE_PMC_REQUEST_ID_REUSED');}
      catch(error){if(error.code!=='ENOENT')throw error;saved={request:input,fingerprint,createdAt:stamp()};await retain(requestPath,jsonBytes(saved));}
      let before=await metadata(input.dossierId);
      const intentId='epmc-receive:'+input.requestId, editionId='e_'+sha256(Buffer.from(input.questionId+'\n'+'europe-pmc'+'\n'+selected.operation.editionSha256+'\n'+intentId));
      if(await exists(receiptPath)) {
        const receipt=await readJson(receiptPath,1024*1024);need(receipt.fingerprint===fingerprint,'EUROPE_PMC_RECEIPT_CHANGED');
        const original=before.revision===receipt.revision?before:await metadata(input.dossierId,{revision:receipt.revision});
        need(original.editions.some(row=>row.id===receipt.editionId&&row.raw?.sha256===receipt.sourceSha256),'EUROPE_PMC_RECEIVED_EDITION_MISSING');
        return {receipt,dossier:before,duplicate:true};
      }
      let retained=before.editions.find(row=>row.id===editionId&&row.raw?.sha256===selected.operation.editionSha256);
      if(!retained) {
        need(before.revision===input.expectedRevision,'REVISION_CONFLICT');
        need(before.questions.some(row=>row.id===input.questionId),'QUESTION_NOT_FOUND');
        await dossiers.receive(input.dossierId,{questionId:input.questionId,label:input.label,provider:'europe-pmc',rawBytes:selected.bytes,
          sourceReference:requestFor(selected.plan.payload.query.selection).url,expectedRevision:input.expectedRevision,
          origin:{mode:'EUROPE_PMC_WORKSPACE',intentId,operationId,planSha256:selected.plan.sha256,actor:input.actor},projection:'metadata'});
        before=await metadata(input.dossierId);retained=before.editions.find(row=>row.id===editionId);
      }
      need(retained&&retained.raw?.sha256===selected.operation.editionSha256,'EUROPE_PMC_RECEIVE_RECONCILIATION_FAILED');
      const revision=input.expectedRevision+1, original=before.revision===revision?before:await metadata(input.dossierId,{revision});
      need(original.editions.some(row=>row.id===editionId&&row.raw?.sha256===selected.operation.editionSha256),'EUROPE_PMC_RECEIVE_RECONCILIATION_FAILED');
      const receipt={schema:'stellar-forge.europe-pmc-receipt.v1',fingerprint,requestId:input.requestId,operationId,dossierId:input.dossierId,
        questionId:input.questionId,editionId,sourceSha256:selected.operation.editionSha256,sourceBytes:selected.operation.editionBytes,
        originalRevision:input.expectedRevision,revision,receivedAt:saved.createdAt,coverage:selected.value.usage.coverage,records:selected.value.results.length};
      await retain(receiptPath,jsonBytes(receipt));return {receipt,dossier:before,duplicate:false};
    });
  }
  async function comparison({before,after,offset=0,limit=30,status='all'}) {
    need(integer(offset)&&Number.isInteger(limit)&&limit>=1&&limit<=100,'EUROPE_PMC_PAGE_INVALID');
    need(['all','ADDED','ABSENT_FROM_NEW_EDITION','METADATA_CHANGED','UNCHANGED'].includes(status),'EUROPE_PMC_COMPARISON_STATUS_INVALID');
    const full=compareEditions((await edition(before)).value,(await edition(after)).value);
    const selected=full.items.filter(row=>status==='all'||row.status===status);
    return {...full,items:selected.slice(offset,offset+limit),total:selected.length,nextOffset:offset+limit<selected.length?offset+limit:null};
  }
  async function sourceFile(operationId,{index,descriptor=false,boundary=false}={}) {
    need(integer(index),'EUROPE_PMC_SOURCE_INDEX_INVALID');await plan(operationId);
    const pages=await sourcePages(operationId),document=boundary?await boundaryPage(operationId):pages[index];need(document,'EUROPE_PMC_SOURCE_NOT_FOUND');
    const {bytes}=validateDocument(document);
    if(descriptor){const {bodyBase64,...metadata}=document;return metadata;}
    return {filename:'Europe_PMC_Original_Page_'+String(index+1)+'.json',type:'application/json',bytes};
  }
  async function list({offset=0,limit=30}={}) {
    need(integer(offset)&&Number.isInteger(limit)&&limit>=1&&limit<=100,'EUROPE_PMC_PAGE_INVALID');
    const current=await library(), names=await operationIds();
    const items=[];for(const name of names.slice(offset,offset+limit))items.push(await inspect(name));
    let receiving=null;try{receiving=await readJson(join(directory,'receiving.json'),32768);}catch(error){if(error.code!=='ENOENT')throw error;}
    return {schema:LIBRARY,id:current.id,revision:current.revision,queries:Object.values(current.queries),operations:items,
      totalOperations:names.length,nextOffset:offset+limit<names.length?offset+limit:null,receiving,active:[...active.keys()]};
  }
  async function operationFile(operationId,format) {
    const selected=await edition(operationId);
    if(format==='edition')return {filename:'Europe_PMC_Source_Edition.json',type:'application/json',bytes:selected.bytes};
    if(format==='ris')return {filename:'Europe_PMC_Records.ris',type:'application/x-research-info-systems',bytes:exportRIS(selected.value)};
    if(format==='csv')return {filename:'Europe_PMC_Records.csv',type:'text/csv; charset=utf-8',bytes:exportCSV(selected.value)};
    if(format==='review') {
      const current=await library(),reviews=Object.values(current.reviews).filter(row=>row.operationId===operationId);
      return {filename:'Europe_PMC_Review.json',type:'application/json',bytes:jsonBytes({operationId,editionSha256:selected.operation.editionSha256,reviews})};
    }
    throw Object.assign(new Error('Unknown export'),{code:'EUROPE_PMC_EXPORT_FORMAT_INVALID'});
  }
  async function exportWorkspace(input) {
    requestId(input.requestId);actorValue(input.actor);need(Object.keys(input).every(key=>['requestId','actor'].includes(key)),'EUROPE_PMC_EXPORT_FIELDS_INVALID');
    const name=keyHash(input.requestId), target=await privateDirectory(join(exportsRoot,name));
    return withPrivateLock(target,'export.lock',async()=>{
      const fingerprint=keyHash(input), preparation=join(target,'prepared.json'), output=join(target,'Europe_PMC_Workspace.json.gz'), receiptPath=join(target,'receipt.json');
      if(await exists(receiptPath)) {
        const receipt=await readJson(receiptPath,32768);need(receipt.fingerprint===fingerprint,'EUROPE_PMC_REQUEST_ID_REUSED');
        let body;try{body=await readBytes(output,PORTABLE_LIMIT);}catch(error){if(error.code==='ENOENT')throw Object.assign(new Error('Retained export unavailable; create a new export request'),{code:'EUROPE_PMC_RETAINED_ARTIFACT_UNAVAILABLE'});throw error;}
        need(body.length===receipt.bytes&&sha256(body)===receipt.sha256,'EUROPE_PMC_RETAINED_ARTIFACT_CHANGED');return receipt;
      }
      let prepared;
      if(await exists(preparation)) {
        prepared=await readJson(preparation,PORTABLE_LIMIT);need(prepared.fingerprint===fingerprint,'EUROPE_PMC_REQUEST_ID_REUSED');
      } else {
        const members=[];
        await transact(async current=>{
          members.push({name:'library.json',body:jsonBytes(current)});
          if(await exists(join(directory,'receiving.json')))members.push({name:'receiving.json',body:await readBytes(join(directory,'receiving.json'),32768)});
          const ids=await operationIds();
          for(const operationId of ids)await withPrivateLock(folder(operationId),'operation.lock',async()=>{
            for(const name of ['plan.json','state.json','edition.json','boundary-page.json'])if(await exists(join(folder(operationId),name)))
              members.push({name:'operations/'+operationId+'/'+name,body:await readBytes(join(folder(operationId),name),MAX_EDITION_BYTES)});
            if(!await exists(join(folder(operationId),'state.json')))members.push({name:'operations/'+operationId+'/state.json',body:jsonBytes(await state(operationId))});
            for(const sub of ['source-pages','failed-pages','receipts'])for(const name of (await readdir(join(folder(operationId),sub))).sort()) {
              const relative='operations/'+operationId+'/'+sub+'/'+name;
              if(portableMember(relative))members.push({name:relative,body:await readBytes(join(folder(operationId),sub,name),MAX_EDITION_BYTES)});
            }
          });
          const envelope={schema:PORTABLE,workspace:{id:current.id,revision:current.revision},createdAt:stamp(),
            export:{requestId:input.requestId,actor:input.actor},
            members:members.map(({name,body})=>({name,bytes:body.length,sha256:sha256(body),base64:body.toString('base64')}))};
          const bytes=jsonBytes(envelope);need(bytes.length<=PORTABLE_LIMIT,'EUROPE_PMC_PORTABLE_SIZE_EXCEEDED');validateEuropePmcPortable(bytes);
          prepared={fingerprint,input,portable:envelope};await retain(preparation,jsonBytes(prepared));
        });
      }
      const body=gzipSync(jsonBytes(prepared.portable),{level:6}), info=await retain(output,body);
      const receipt={schema:'stellar-forge.europe-pmc-export.v1',requestId:input.requestId,fingerprint,filename:'Europe_PMC_Workspace.json.gz',
        ...info,workspace:prepared.portable.workspace,members:prepared.portable.members.length,createdAt:prepared.portable.createdAt};
      await retain(receiptPath,jsonBytes(receipt));return receipt;
    });
  }
  async function readExport(input) {
    const name=keyHash(requestId(input.requestId)), target=join(exportsRoot,name), receipt=await readJson(join(target,'receipt.json'),32768);
    let bytes;try{bytes=await readBytes(join(target,'Europe_PMC_Workspace.json.gz'),PORTABLE_LIMIT);}
    catch(error){if(error.code==='ENOENT')throw Object.assign(new Error('Retained export unavailable; create a new export request'),{code:'EUROPE_PMC_RETAINED_ARTIFACT_UNAVAILABLE'});throw error;}
    need(bytes.length===receipt.bytes&&sha256(bytes)===receipt.sha256,'EUROPE_PMC_RETAINED_ARTIFACT_CHANGED');return {receipt,bytes};
  }
  const methods={list,query,saveQuery,prepare,continueSearch,chain,inspect,start,stop,seal,importDocuments,edition,records,reviewRecord,receive,comparison,sourceFile,operationFile,exportWorkspace,readExport,
    async history(){const current=await library();return {workspaceId:current.id,revision:current.revision,events:current.events};}};
  const api={};for(const [name,work] of Object.entries(methods))api[name]=(...args)=>tracked(()=>work(...args));
  api.close=async()=>{if(closed)return;closed=true;for(const entry of active.values())entry.controller.abort();
    await Promise.allSettled([...active.values()].map(entry=>entry.promise));await Promise.allSettled([...tasks]);await serial;};
  return api;
}
