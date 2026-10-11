// MIT. Complete retained Treasury capture/review/delivery; original merchant engines.
import { mkdir, readdir, lstat, rename, rm, open, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { acquireWorkspace, privateDirectory, readPrivate, readJson, createFile,
  atomicJson, syncDirectory, bytes, digest, identity, hashPrivate, fault, object } from '../postgres/publisher/files.mjs';
import { API_BASE, CATALOG_URL, FIELD, endpointPath, sourceQuery, fetchFiscal, jsonResponse, inspectPage,
  normalizeCatalog, textValue } from './capture.mjs';
import { decimalParts, addDecimals, subtractDecimals, equalDecimals, positiveDecimal } from './decimal.mjs';
import { openFiscalPublisher } from './publishing.mjs';

const SCHEMA = 'stellar-forge.fiscaldata-workspace.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MiB = 1024 ** 2;
const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
const GROUPS = ['catalogs','sources','captures','editions','comparisons','exports'];
const defaults = { maxResponseBytes: 8 * MiB, maxCatalogBytes: 16 * MiB, maxCaptureBytes: 64 * MiB,
  maxPages: 2000, maxRows: 250000, maxCaptures: 128, maxEditions: 128, maxComparisons: 128, maxExports: 256,
  requestTimeoutMs: 30000 };
const absent = async path => { try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };
const safeName = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(name);
const errorView = error => ({ code: typeof error.code === 'string' ? error.code : 'FISCALDATA_OPERATION_FAILED',
  message: String(error.message ?? error), at: now() });
function only(input, fields) {
  if (!object(input) || Object.keys(input).some(key => !fields.includes(key)))
    throw fault('ACTION_FIELDS', 'The action contains unsupported fields.');
}
function label(value, maximum = 160, required = true) {
  if (!textValue(value, maximum) || required && !value.trim())
    throw fault('REVIEW_TEXT_INVALID', 'Enter ' + (required ? 'a value' : 'text') + ' within ' + maximum + ' characters.');
  return value.trim();
}
function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw fault('INTEGER_REQUIRED', name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}
function expected(record, revision) {
  if (record.revision !== revision) throw fault('REVISION_CHANGED', 'This saved selection changed. Refresh it before saving your edits.', 409);
}
function requestIdentity(action, input) {
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(input.requestId))
    throw fault('REQUEST_ID_REQUIRED', 'Keep a unique request ID for this creation and reuse it only when retrying that same input.');
  return { requestKey: action + ':' + input.requestId, inputSha256: identity(input) };
}
function assertId(id) {
  if (!UUID.test(id ?? '')) throw fault('SAVED_ID_INVALID', 'Choose an original saved workspace item.', 404);
  return id;
}
function pageWindow(input, maximum = 500) {
  return { offset: integer(input.offset ?? 0, 0, 10000000, 'Offset'), limit: integer(input.limit ?? 50, 1, maximum, 'Page size') };
}
const csvCell = value => value === null ? '' : /[",\r\n]/.test(String(value)) ? '"' + String(value).replaceAll('"', '""') + '"' : String(value);
const csvLine = row => row.map(csvCell).join(',') + '\r\n';
function plainFields(entry) {
  return entry.fields.map(({raw, ...field}) => field);
}
function catalogView(record) {
  return record ? { id: record.id, observedAt: record.observedAt, sha256: record.sha256,
    datasetCount: record.datasetCount, endpoints: record.endpoints.map(({raw, ...entry}) => ({ ...entry, fields: plainFields(entry) })) } :
    { id: null, observedAt: null, sha256: null, endpoints: [] };
}
function captureView(record) {
  const { source, pageRecords, attempts, responses, pending, metadata, files, consistency, ...summary } = record;
  return { ...summary, pages: pageRecords.length, attemptCount: attempts.length };
}
function editionView(record) {
  const { observations, ...summary } = record;
  return {...summary,files:(record.files??[]).map(({relative,...file})=>file)};
}
async function immutable(path, data) {
  try { await createFile(path, data); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readPrivate(path, Math.max(data.length + 1, MiB))).equals(data))
      throw fault('IMMUTABLE_FILE_CHANGED', 'An existing retained file differs from its original content.', 409);
  }
}
async function fileDescriptor(root, name, mime, relativePath = name, maximum = 256 * MiB) {
  const value = await hashPrivate(join(root, relativePath), maximum);
  return { name, mime, size: value.bytes, sha256: value.hash, relative: relativePath };
}
function fieldNames(values, allowed, name, maximum = 8) {
  if (!Array.isArray(values) || values.length > maximum || new Set(values).size !== values.length ||
      values.some(value => typeof value !== 'string' || !allowed.includes(value)))
    throw fault('FIELD_SELECTION_INVALID', 'Choose distinct existing fields for ' + name + '.');
  return [...values];
}

/** One kernel-owned metadata writer. Background network reads commit one original page at a time. */
export async function openFiscalWorkspace({ directory, buyerWorkspaces = [], limits: suppliedLimits = {} } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/')
    throw fault('WORKSPACE_PATH_REQUIRED', 'Use a normalized absolute private workspace directory.');
  if (!object(suppliedLimits) || Object.keys(suppliedLimits).some(key => !Object.hasOwn(defaults, key)))
    throw fault('WORKSPACE_LIMITS', 'Use the documented workspace limits.');
  const limits = { ...defaults, ...suppliedLimits };
  for (const [key, value] of Object.entries(limits)) integer(value, 1, key.endsWith('Bytes') ? 1024 * MiB : 10000000, key);
  if (limits.requestTimeoutMs > 120000 || limits.maxResponseBytes > limits.maxCaptureBytes || limits.maxRows > 1000000)
    throw fault('WORKSPACE_LIMITS', 'Keep request timeout within 120 seconds, page bytes within capture bytes and rows within the original million-row limit.');
  if (!Array.isArray(buyerWorkspaces) || buyerWorkspaces.length > 32 ||
      new Set(buyerWorkspaces.map(value => value.id)).size !== buyerWorkspaces.length)
    throw fault('BUYER_BINDINGS_INVALID', 'Configure distinct original buyer workspaces.');
  for (const binding of buyerWorkspaces) {
    if (!object(binding) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(binding.id ?? '') ||
        !textValue(binding.label, 160) || !binding.label.trim() ||
        typeof binding.directory !== 'string' || !isAbsolute(binding.directory) || resolve(binding.directory) !== binding.directory)
      throw fault('BUYER_BINDINGS_INVALID', 'Each buyer workspace needs its original ID, label and canonical absolute directory.');
  }
  await privateDirectory(directory, true);
  const unlock = await acquireWorkspace(directory);
  const roots = Object.fromEntries([...GROUPS, 'downloads', 'staging'].map(key => [key, join(directory, key)]));
  const records = Object.fromEntries(GROUPS.map(group => [group, new Map()]));
  let header, tail = Promise.resolve(), workerPromise = null, workerEnabled = false, activeCaptureId = null;
  let controller = null, closing = false, closed = false, publisher, closePromise;
  const warnings = [], datasets = new Map();
  const pathFor = (group,id) => join(roots[group], assertId(id));
  function get(group,id) {
    const record = records[group]?.get(assertId(id));
    if (!record) throw fault('SAVED_ITEM_MISSING', 'This workspace has no such saved ' + group.slice(0,-1) + '.', 404);
    return clone(record);
  }
  function serial(operation) {
    const next = tail.catch(() => {}).then(operation);
    tail = next; return next;
  }
  async function headerSave() {
    header = { ...header, revision: header.revision + 1, updatedAt: now() };
    try { await atomicJson(directory, 'workspace.json', header); }
    catch (error) {
      warnings.push({ code: 'WORKSPACE_INDEX_WRITE', message: 'The original item is retained. The workspace index will be reconstructed on reopen.', at: now(), detail: error.code });
      if(warnings.length>128)warnings.splice(0,warnings.length-128);
    }
  }
  async function save(group, record) {
    const root = pathFor(group, record.id);
    await privateDirectory(root, true);
    await atomicJson(root, 'record.json', record);
    records[group].set(record.id, clone(record));
    await headerSave();
    return clone(record);
  }
  function requestExisting(group, action, input) {
    const pin = requestIdentity(action,input);
    const record = [...records[group].values()].find(value => value.requestKey === pin.requestKey);
    if (record && record.inputSha256 !== pin.inputSha256)
      throw fault('REQUEST_ID_CONFLICT', 'This request ID already belongs to different retained input.', 409);
    return { pin, record: record ? clone(record) : null };
  }
  function fileRecords(record) {
    return (record.files ?? []).map(({relative,...item}) => item);
  }
  async function verified(root, descriptor) {
    if (!safeName(descriptor.name) || typeof descriptor.relative !== 'string' ||
        descriptor.relative.split('/').some(value => !safeName(value)))
      throw fault('RETAINED_FILE_PATH', 'The saved file manifest contains an invalid path.', 409);
    const path = join(root, descriptor.relative);
    if (await realpath(path) !== path) throw fault('RETAINED_FILE_PATH', 'Use the original retained file without symbolic links.', 409);
    const actual = await hashPrivate(path, Math.max(descriptor.size + 1, MiB));
    if (actual.hash !== descriptor.sha256 || actual.bytes !== descriptor.size)
      throw fault('RETAINED_FILE_CHANGED', 'The retained original file differs from its manifest.', 409);
    return { path, name: descriptor.name, mime: descriptor.mime, sha256: descriptor.sha256, size: descriptor.size };
  }
  async function sourceVersion(id, revision) {
    const latest = get('sources',id);
    revision = revision ?? latest.revision;
    integer(revision,1,latest.revision,'Source revision');
    const record = await readJson(join(pathFor('sources',id), 'revisions', String(revision)+'.json'), 16*MiB);
    const {sha256,...pinned} = record;
    if (record.id!==id || record.revision!==revision || identity(pinned)!==sha256)
      throw fault('SOURCE_REVISION_CHANGED','The retained source revision differs from its original identity.',409);
    return record;
  }
  try {
    if (await absent(join(directory,'workspace.json'))) {
      const existing = await readdir(directory);
      if (existing.some(name => name !== 'publisher.lock' && !name.startsWith('.pending-')))
        throw fault('WORKSPACE_METADATA_MISSING','Choose the original workspace or a new empty private directory.',409);
      header={schema:SCHEMA,id:randomUUID(),revision:1,createdAt:now(),updatedAt:now(),catalogId:null};
      await atomicJson(directory,'workspace.json',header);
    } else header=await readJson(join(directory,'workspace.json'),MiB);
    if (header.schema!==SCHEMA || !UUID.test(header.id??'') || !Number.isSafeInteger(header.revision))
      throw fault('WORKSPACE_METADATA_INVALID','The retained workspace metadata needs repair.',409);
    for(const root of Object.values(roots)) await privateDirectory(root,true);
    for(const group of GROUPS) for(const entry of await readdir(roots[group],{withFileTypes:true})) {
      if(!entry.isDirectory() || !UUID.test(entry.name)) continue;
      try {
        const record=await readJson(join(roots[group],entry.name,'record.json'),32*MiB);
        if(record.id!==entry.name || record.kind!==group || !Number.isSafeInteger(record.revision))
          throw fault('RETAINED_RECORD_INVALID');
        records[group].set(record.id,record);
      } catch(error) {
        if(group==='sources' && error.code==='ENOENT') {
          const first=await readJson(join(roots.sources,entry.name,'revisions','1.json'),16*MiB);
          const {sha256,...data}=first;
          if(first.id!==entry.name||first.kind!=='sources'||first.revision!==1||first.previousSha256!==null||identity(data)!==sha256)
            throw fault('SOURCE_REVISION_CHAIN','The original source revision needs repair.',409);
          await save('sources',first);
        } else warnings.push({group,id:entry.name,...errorView(error)});
      }
    }
    // A source revision is committed before the convenient latest-record index.
    for(const record of [...records.sources.values()]) {
      const revisions=join(pathFor('sources',record.id),'revisions');
      if(await absent(revisions)) continue;
      let current=record;
      const names=(await readdir(revisions)).filter(name=>/^[1-9]\d*\.json$/.test(name))
        .sort((a,b)=>Number(a.slice(0,-5))-Number(b.slice(0,-5)));
      for(const name of names) {
        const revision=Number(name.slice(0,-5));
        if(revision<=current.revision)continue;
        const next=await readJson(join(revisions,name),16*MiB);
        const {sha256,...data}=next;
        if(revision!==current.revision+1 || next.previousSha256!==current.sha256 || identity(data)!==sha256)
          throw fault('SOURCE_REVISION_CHAIN','The source revision history needs original-source repair.',409);
        current=next;
      }
      if(current.revision!==record.revision)await save('sources',current);
    }
    if(!header.catalogId || !records.catalogs.has(header.catalogId))
      header.catalogId=[...records.catalogs.values()].sort((a,b)=>a.observedAt.localeCompare(b.observedAt)).at(-1)?.id??null;
    for(const record of records.captures.values()) {
      if(record.status==='RUNNING') {
        record.status=record.desiredState==='RUNNING'?'QUEUED':record.desiredState==='CANCELLED'?'CANCELLED':'PAUSED';
        record.recoveredAt=now(); record.revision++; record.updatedAt=now(); await save('captures',record);
      }
    }
    publisher=await openFiscalPublisher({directory:join(directory,'publisher'),buyerWorkspaces,
      resolveExport:async id=>{
        const record=get('exports',id);
        if(record.status!=='READY')throw fault('EXPORT_NOT_READY','Complete this retained merchant export before preparing publication.',409);
        for(const item of record.files)await verified(pathFor('exports',id),item);
        return {...record,kind:record.exportKind,directory:pathFor('exports',id)};
      },
      retainDownload:async(id,name,data,mime)=>{
        assertId(id); const target=join(roots.downloads,id);await privateDirectory(target,true);
        const hash=digest(data), retainedName=hash+'-'+name;
        await immutable(join(target,retainedName),data);
        return {path:join(target,retainedName),name,mime,sha256:hash,size:data.length};
      },
      retainAcquisition:result=>retainAcquisition(result)
    });
  } catch(error) { await unlock();throw error; }

  async function snapshot() {
    if(closed)throw fault('WORKSPACE_CLOSED','Reopen this Fiscal Data workspace.',409);
    const sort=group=>[...records[group].values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return {schema:SCHEMA,revision:header.revision,createdAt:header.createdAt,observedAt:now(),
      catalog:catalogView(records.catalogs.get(header.catalogId)),sources:sort('sources').map(clone),
      captures:sort('captures').map(captureView),editions:sort('editions').map(editionView),
      comparisons:sort('comparisons').map(value=>{const {rowDetails,...summary}=value;return clone(summary);}),
      exports:sort('exports').map(exportView),
      buyerWorkspaces:buyerWorkspaces.map(({id,label})=>({id,label})),publisher:await publisher.state(),
      worker:{running:workerEnabled,captureId:activeCaptureId},limits:clone(limits),recoveryWarnings:clone(warnings)};
  }
  async function refreshCatalog() {
    const response=await fetchFiscal(CATALOG_URL,{maxBytes:limits.maxCatalogBytes,timeoutMs:limits.requestTimeoutMs});
    const original=jsonResponse(response),endpoints=normalizeCatalog(original),id=randomUUID(),root=pathFor('catalogs',id);
    await privateDirectory(root,true);
    await immutable(join(root,'original.json'),response.body);
    await immutable(join(root,'receipt.json'),bytes(response.receipt));
    const record={id,kind:'catalogs',revision:1,createdAt:now(),observedAt:response.receipt.observedAt,
      sha256:response.receipt.sha256,datasetCount:original.length,endpoints};
    await save('catalogs',record); header.catalogId=id;await headerSave();
    return catalogView(record);
  }
  async function saveSource(input) {
    only(input,['id','expectedRevision','name','endpoint','filter','sort','pageSize','notes']);
    const old=input.id?get('sources',input.id):null;
    if(old)expected(old,input.expectedRevision);
    const endpoint=endpointPath(input.endpoint),catalog=records.catalogs.get(header.catalogId);
    const entry=catalog?.endpoints.find(item=>item.endpoint===endpoint)??null;
    const record={id:old?.id??randomUUID(),kind:'sources',revision:(old?.revision??0)+1,
      name:label(input.name),endpoint,filter:label(input.filter??'',8192,false),sort:label(input.sort??'',2048,false),
      pageSize:integer(input.pageSize??1000,1,10000,'Page size'),notes:label(input.notes??'',8000,false),
      createdAt:old?.createdAt??now(),updatedAt:now(),previousSha256:old?.sha256??null,
      catalog:entry?{id:catalog.id,sha256:catalog.sha256,entry:clone(entry)}:null,lastProbe:null};
    sourceQuery(record);
    record.sha256=identity(record);
    const root=pathFor('sources',record.id);await privateDirectory(root,true);await privateDirectory(join(root,'revisions'),true);
    await immutable(join(root,'revisions',record.revision+'.json'),bytes(record));
    return save('sources',record);
  }
  async function probeSource(input) {
    only(input,['id','revision']);
    const source=await sourceVersion(input.id,input.revision),response=await fetchFiscal(sourceQuery(source,1,5),
      {maxBytes:limits.maxResponseBytes,timeoutMs:limits.requestTimeoutMs});
    const page=inspectPage(response,source,1,null,5),id=randomUUID(),root=join(pathFor('sources',source.id),'probes');
    await privateDirectory(root,true);
    const record={id,sourceRevision:source.revision,sourceSha256:source.sha256,observedAt:response.receipt.observedAt,
      sha256:response.receipt.sha256,meta:page.value.meta,fields:page.fields,sampleRows:page.rows,
      definitions:source.catalog?.entry?.fields??[],receipt:response.receipt};
    await immutable(join(root,id+'.json'),response.body);await immutable(join(root,id+'.receipt.json'),bytes(record));
    const latest=get('sources',source.id);
    if(latest.revision===source.revision) {
      latest.lastProbe=record;
      // A probe observation does not change the immutable configuration identity.
      await save('sources',latest);
    }
    return record;
  }
  async function beginCapture(input) {
    only(input,['sourceId','sourceRevision','sourceSha256','requestId','name']);
    const found=requestExisting('captures','captures.start',input);
    if(found.record)return captureView(found.record);
    if(records.captures.size>=limits.maxCaptures)throw fault('CAPTURE_CAPACITY','Open another workspace for additional retained captures.',409);
    const source=await sourceVersion(input.sourceId,input.sourceRevision);
    if(source.sha256!==input.sourceSha256)throw fault('SOURCE_SELECTION_CHANGED','Choose the exact reviewed source revision.',409);
    const id=randomUUID(),root=pathFor('captures',id);
    await privateDirectory(root,true);await privateDirectory(join(root,'attempts'),true);
    await immutable(join(root,'source.json'),bytes(source));
    const record={id,kind:'captures',revision:1,...found.pin,sourceId:source.id,sourceRevision:source.revision,
      sourceSha256:source.sha256,name:label(input.name??source.name),source,createdAt:now(),updatedAt:now(),
      status:'QUEUED',desiredState:'RUNNING',pageRecords:[],attempts:[],responses:{},pending:null,
      rows:0,totalRows:null,totalPages:null,bytes:0,nextPage:1,metadata:null,metadataSha256:null,
      sha256:null,error:null,completedAt:null,files:[],consistency:[],duplicates:null};
    await save('captures',record);kick();return captureView(record);
  }
  async function captureIntent(action,input) {
    only(input,['id']);const record=get('captures',input.id);
    if(record.status==='COMPLETE')return captureView(record);
    if(record.status==='CANCELLED' && action!=='cancel')
      throw fault('CAPTURE_CANCELLED','This original capture was cancelled. Start a new dated capture from its source.',409);
    record.desiredState=action==='resume'?'RUNNING':action==='cancel'?'CANCELLED':'PAUSED';
    if(action==='resume') {record.status='QUEUED';record.error=null;}
    else if(activeCaptureId!==record.id)record.status=record.desiredState;
    record.revision++;record.updatedAt=now();await save('captures',record);
    if(activeCaptureId===record.id && action!=='resume')controller?.abort();
    kick();return captureView(record);
  }
  async function mutateCapture(id,change) {
    return serial(async()=>{const record=get('captures',id);change(record);record.revision++;record.updatedAt=now();return save('captures',record);});
  }
  async function originalResponse(id,labelName,url,signal) {
    let job=get('captures',id),pending=job.pending;
    const saved=job.responses[labelName];
    if(saved) {
      const root=join(pathFor('captures',id),'attempts',saved.id);
      const receipt=await readJson(join(root,'receipt.json'),65536),body=await readPrivate(join(root,'body.json'),limits.maxResponseBytes);
      if(receipt.url!==url || digest(body)!==receipt.sha256)throw fault('CAPTURE_RESPONSE_CHANGED','The retained original source response changed.',409);
      return {body,receipt,attemptId:saved.id};
    }
    if(pending && (pending.label!==labelName || pending.url!==url))
      throw fault('CAPTURE_PENDING_DIFFERENT','Resume the original retained Treasury request before another page.',409);
    if(!pending) {
      pending={id:randomUUID(),label:labelName,url,requestedAt:now()};
      await mutateCapture(id,record=>{record.pending=pending;});
    }
    let root=join(pathFor('captures',id),'attempts',pending.id);
    const staged=root+'.stage';
    if(await absent(root) && !await absent(staged)) {
      const complete=!(await absent(join(staged,'receipt.json'))||await absent(join(staged,'body.json'))||await absent(join(staged,'request.json')));
      if(complete) {
        const request=await readJson(join(staged,'request.json'),65536),receipt=await readJson(join(staged,'receipt.json'),65536);
        const body=await readPrivate(join(staged,'body.json'),limits.maxResponseBytes);
        if(identity(request)!==identity(pending)||receipt.url!==url||receipt.sha256!==digest(body)||receipt.size!==body.length)
          throw fault('CAPTURE_RESPONSE_CHANGED','The original staged Treasury response needs repair.',409);
        await rename(staged,root);await syncDirectory(join(pathFor('captures',id),'attempts'));
      } else {
        const retained=staged+'.partial-'+randomUUID();await rename(staged,retained);
        const prior=pending;pending={id:randomUUID(),label:labelName,url,requestedAt:now()};
        await mutateCapture(id,record=>{record.attempts.push({...prior,status:null,error:{code:'RESPONSE_WRITE_INTERRUPTED',message:'Partial response bytes retained.',at:now()},partialDirectory:relative(pathFor('captures',id),retained)});record.pending=pending;});
        root=join(pathFor('captures',id),'attempts',pending.id);
      }
    }
    let response;
    if(!await absent(root)) {
      const receipt=await readJson(join(root,'receipt.json'),65536),body=await readPrivate(join(root,'body.json'),limits.maxResponseBytes);
      if(receipt.url!==url || digest(body)!==receipt.sha256)throw fault('CAPTURE_RESPONSE_CHANGED','The saved Treasury response changed.',409);
      response={receipt,body};
    } else {
      try {response=await fetchFiscal(url,{signal,maxBytes:limits.maxResponseBytes,timeoutMs:limits.requestTimeoutMs});}
      catch(error) {
        await mutateCapture(id,record=>{record.attempts.push({...pending,status:null,error:errorView(error),
          receipt:error.sourceReceipt??null});record.pending=null;});
        throw error;
      }
      const staged=root+'.stage';
      await privateDirectory(staged,true);
      await immutable(join(staged,'request.json'),bytes(pending));
      await immutable(join(staged,'body.json'),response.body);
      await immutable(join(staged,'receipt.json'),bytes(response.receipt));
      await syncDirectory(staged);await rename(staged,root);await syncDirectory(join(pathFor('captures',id),'attempts'));
    }
    const summary={...pending,...response.receipt};
    await mutateCapture(id,record=>{
      if(!record.attempts.some(value=>value.id===pending.id))record.attempts.push(summary);
      record.pending=null;
      if(response.receipt.status===200)record.responses[labelName]={id:pending.id,sha256:response.receipt.sha256};
    });
    return {...response,attemptId:pending.id};
  }
  async function* captureRows(record) {
    let ordinal=0;
    for(const item of record.pageRecords) {
      const root=join(pathFor('captures',record.id),'attempts',item.attemptId);
      const body=await readPrivate(join(root,'body.json'),limits.maxResponseBytes);
      if(digest(body)!==item.sha256)throw fault('CAPTURE_SOURCE_CHANGED','An original captured page changed.',409);
      const receipt=await readJson(join(root,'receipt.json'),65536);
      const page=inspectPage({body,receipt},record.source,item.page,record);
      for(let index=0;index<page.rows.length;index++)yield {ordinal:ordinal++,page:item.page,index,values:page.rows[index]};
    }
    if(ordinal!==record.rows)throw fault('CAPTURE_ROWS_CHANGED','The retained page inventory no longer matches its row count.',409);
  }
  async function captureFiles(record) {
    const root=pathFor('captures',record.id);
    const list=[await fileDescriptor(root,'source.json','application/json')];
    for(const attempt of record.attempts) {
      if(!attempt.sha256)continue;
      const page=record.pageRecords.find(item=>item.attemptId===attempt.id);
      const name=page?'page-'+String(page.page).padStart(6,'0')+'.json':'observation-'+attempt.id+'.json';
      list.push(await fileDescriptor(root,name,'application/json','attempts/'+attempt.id+'/body.json',limits.maxResponseBytes));
      list.push(await fileDescriptor(root,name.replace(/\.json$/,'.receipt.json'),'application/json','attempts/'+attempt.id+'/receipt.json'));
    }
    if(!await absent(join(root,'capture.json')))list.push(await fileDescriptor(root,'capture.json','application/json'));
    return list;
  }
  async function recoverSealedCapture(id) {
    const root=pathFor('captures',id),record=get('captures',id);
    if(await absent(join(root,'capture.json')))return false;
    const raw=await readPrivate(join(root,'capture.json'),32*MiB),manifest=JSON.parse(raw);
    if(manifest.id!==id||manifest.sourceSha256!==record.sourceSha256||manifest.rows!==record.rows||
       identity(manifest.pageRecords)!==identity(record.pageRecords)||identity(manifest.source)!==identity(record.source))
      throw fault('CAPTURE_MANIFEST_CHANGED','The sealed capture differs from its original page checkpoints.',409);
    for await(const row of captureRows(record)){void row;}
    record.sha256=digest(raw);record.completedAt=manifest.completedAt;record.status='COMPLETE';record.desiredState='PAUSED';
    record.nextPage=null;record.error=null;record.consistency=manifest.consistency;record.duplicates=manifest.duplicates;
    record.files=await captureFiles(record);
    await mutateCapture(id,current=>Object.assign(current,{...record,revision:current.revision}));return true;
  }
  async function finishCapture(id,signal) {
    if(await recoverSealedCapture(id))return;
    let record=get('captures',id);
    const anchor=await originalResponse(id,'final-anchor-'+randomUUID(),sourceQuery(record.source,1),signal);
    const page=inspectPage(anchor,record.source,1,record);
    if(page.dataSha256!==record.pageRecords[0].dataSha256)
      throw fault('SOURCE_ANCHOR_CHANGED','Treasury changed the beginning of this paged source. Keep this capture and start a new dated capture.',409);
    const seen=new Map(),duplicates=[];
    let duplicateRows=0;
    for await(const row of captureRows(record)) {
      const hash=identity(row.values),first=seen.get(hash);
      if(first!==undefined){duplicateRows++;if(duplicates.length<50)duplicates.push({firstOrdinal:first,ordinal:row.ordinal,page:row.page,index:row.index,sha256:hash});}
      else seen.set(hash,row.ordinal);
    }
    record=get('captures',id);
    record.consistency.push({kind:'FINAL_FIRST_PAGE',observedAt:anchor.receipt.observedAt,sha256:anchor.receipt.sha256,
      semanticSha256:page.semanticSha256,dataSha256:page.dataSha256});
    record.duplicates={rows:duplicateRows,distinctRows:seen.size,examples:duplicates};
    const manifest={schema:'stellar-forge.fiscaldata-capture.v1',id,source:record.source,
      sourceSha256:record.sourceSha256,createdAt:record.createdAt,completedAt:now(),
      rows:record.rows,totalRows:record.totalRows,totalPages:record.totalPages,metadata:record.metadata,
      pageRecords:record.pageRecords,attempts:record.attempts,consistency:record.consistency,duplicates:record.duplicates,
      sourceSnapshotToken:null,consistencyDescription:'Full original columns; coherent native totals/metadata, exact saved page bytes and an unchanged first-page anchor over the recorded capture interval.'};
    const raw=bytes(manifest);await immutable(join(pathFor('captures',id),'capture.json'),raw);
    record.sha256=digest(raw);record.completedAt=manifest.completedAt;record.status='COMPLETE';record.desiredState='PAUSED';
    record.nextPage=null;record.error=null;record.files=await captureFiles(record);
    await mutateCapture(id,current=>Object.assign(current,{...record,revision:current.revision}));
  }
  async function runCapture(id,signal) {
    if(await recoverSealedCapture(id))return;
    let record=get('captures',id);
    if(record.pending){await originalResponse(id,record.pending.label,record.pending.url,signal);record=get('captures',id);}
    if(record.pageRecords.length) {
      // Saved bytes are checked before the next original request.
      for await(const row of captureRows(record)) {void row;}
      const anchor=await originalResponse(id,'resume-anchor-'+randomUUID(),sourceQuery(record.source,1),signal);
      const page=inspectPage(anchor,record.source,1,record);
      if(page.dataSha256!==record.pageRecords[0].dataSha256)
        throw fault('SOURCE_ANCHOR_CHANGED','The first page changed while this capture was paused. Start a new dated capture.',409);
      await mutateCapture(id,current=>current.consistency.push({kind:'RESUME_FIRST_PAGE',observedAt:anchor.receipt.observedAt,
        sha256:anchor.receipt.sha256,dataSha256:page.dataSha256}));
    }
    while(workerEnabled&&!closing&&!signal.aborted) {
      record=get('captures',id);
      if(record.desiredState!=='RUNNING')break;
      if(record.nextPage===null){await finishCapture(id,signal);return;}
      if(record.pageRecords.length>=limits.maxPages)throw fault('CAPTURE_PAGE_LIMIT','This capture reached its explicit page limit. Its source pages remain retained.',413);
      const pageNumber=record.nextPage;
      const response=await originalResponse(id,'page-'+pageNumber,sourceQuery(record.source,pageNumber),signal);
      const page=inspectPage(response,record.source,pageNumber,record.pageRecords.length?record:null);
      if(page.totalRows>limits.maxRows || record.bytes+response.body.length>limits.maxCaptureBytes)
        throw fault('CAPTURE_CAPACITY','This source exceeds the configured row or raw-byte capacity. Use an explicit narrower Treasury filter or a larger operator capacity.',413);
      await mutateCapture(id,current=>{
        if(current.pageRecords.some(item=>item.page===pageNumber))return;
        current.pageRecords.push({page:pageNumber,attemptId:response.attemptId,sha256:response.receipt.sha256,
          dataSha256:page.dataSha256,size:response.body.length,count:page.count,url:response.receipt.url,
          observedAt:response.receipt.observedAt});
        current.metadata=page.metadata;current.metadataSha256=page.metadataSha256;current.fields=page.fields;
        current.rows+=page.count;current.totalRows=page.totalRows;current.totalPages=page.totalPages;
        current.bytes+=response.body.length;current.nextPage=page.nextPage;
      });
    }
    await mutateCapture(id,current=>{if(current.status!=='COMPLETE')current.status=current.desiredState==='CANCELLED'?'CANCELLED':'PAUSED';});
  }
  function kick() {
    if(!workerEnabled||closing||workerPromise)return;
    workerPromise=(async()=>{
      while(workerEnabled&&!closing) {
        const candidate=[...records.captures.values()].filter(value=>value.desiredState==='RUNNING'&&['QUEUED','RUNNING'].includes(value.status))
          .sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
        if(!candidate)break;
        activeCaptureId=candidate.id;controller=new AbortController();
        await mutateCapture(candidate.id,value=>{value.status='RUNNING';value.error=null;});
        try {await runCapture(candidate.id,controller.signal);}
        catch(error) {
          await mutateCapture(candidate.id,value=>{
            value.status=value.desiredState==='CANCELLED'?'CANCELLED':controller.signal.aborted?'PAUSED':'FAILED';
            if(!controller.signal.aborted)value.error=errorView(error);
          });
        } finally {activeCaptureId=null;controller=null;}
      }
    })().catch(error=>warnings.push(errorView(error))).finally(()=>{workerPromise=null;if(workerEnabled&&!closing&&
      [...records.captures.values()].some(value=>value.desiredState==='RUNNING'&&value.status==='QUEUED'))queueMicrotask(kick);});
  }


  async function requireCapture(id,sha256) {
    const record=get('captures',id);
    if(record.status!=='COMPLETE'||!HASH.test(record.sha256??''))
      throw fault('CAPTURE_NOT_COMPLETE','Complete this original capture before creating an edition.',409);
    if(sha256!==undefined&&record.sha256!==sha256)
      throw fault('CAPTURE_SELECTION_CHANGED','Select the exact complete source capture.',409);
    const descriptor=record.files.find(value=>value.name==='capture.json');
    if(!descriptor||descriptor.sha256!==record.sha256)throw fault('CAPTURE_MANIFEST_CHANGED','The capture manifest identity changed.',409);
    await verified(pathFor('captures',id),descriptor);return record;
  }
  async function createEdition(input) {
    only(input,['captureId','captureSha256','name','requestId']);
    const found=requestExisting('editions','editions.create',input);if(found.record)return editionView(found.record);
    if(records.editions.size>=limits.maxEditions)throw fault('EDITION_CAPACITY','Open another workspace for additional retained editions.',409);
    const capture=await requireCapture(input.captureId,input.captureSha256);
    const observations=Object.fromEntries(capture.fields.map(source=>[source,{source,type:capture.metadata.dataTypes[source],
      label:capture.metadata.labels[source],format:capture.metadata.dataFormats[source],
      definition:capture.source.catalog?.entry?.fields.find(item=>item.source===source||item.column_name===source)?.definition??'',
      rows:0,nulls:0,emptyStrings:0,numericRows:0,samples:[]}]));
    for await(const row of captureRows(capture))for(const [name,value] of Object.entries(row.values)){
      const item=observations[name];item.rows++;if(value===null)item.nulls++;else if(value==='')item.emptyStrings++;
      if(decimalParts(value))item.numericRows++;
      if(item.samples.length<5&&!item.samples.some(sample=>sample===value))item.samples.push(value);
    }
    const fields=capture.fields.map(source=>{
      const item=observations[source],type=item.type.toUpperCase();
      return {source,name:source,label:item.label,role:type.includes('DATE')?'date':
        /CURRENCY|NUMBER|DECIMAL|PERCENT|INTEGER/.test(type)?'measure':'dimension',
        unit:'',scale:'1',notes:item.definition||'',nullToken:null};
    });
    const record={id:randomUUID(),kind:'editions',revision:1,...found.pin,captureId:capture.id,captureSha256:capture.sha256,
      name:label(input.name,128),status:'DRAFT',createdAt:now(),updatedAt:now(),fields,keyFields:fields.some(f=>f.name==='record_date')?['record_date']:[],
      notes:'',observations,sourceFields:clone(fields),filters:[],ranges:[],sorts:[],defaultLimit:50,maxLimit:250,
      rowCount:capture.rows,sha256:null,dataset:null,files:[],merchant:null,buildIntent:null,reviewHistory:[]};
    await save('editions',record);return editionView(record);
  }
  function reviewFields(input,record) {
    if(!Array.isArray(input.fields)||!input.fields.length||input.fields.length>256)
      throw fault('EDITION_FIELDS_REQUIRED','Choose at least one original field to publish.');
    const names=new Set(),sources=new Set();
    const fields=input.fields.map(field=>{
      only(field,['source','name','label','role','unit','scale','notes','nullToken']);
      if(!Object.hasOwn(record.observations,field.source)||!/^[a-z][a-z0-9_]{0,47}$/.test(field.name??'')||['constructor','prototype','__proto__'].includes(field.name)||names.has(field.name)||sources.has(field.source))
        throw fault('EDITION_FIELD_IDENTITY','Choose each original field once and use distinct published identifiers.');
      names.add(field.name);sources.add(field.source);
      if(!['identifier','dimension','date','measure'].includes(field.role))throw fault('EDITION_FIELD_ROLE','Choose the field’s analytical role.');
      const result={source:field.source,name:field.name,label:label(field.label,240),role:field.role,
        unit:label(field.unit??'',240,false),scale:field.scale??'1',notes:label(field.notes??'',8000,false),nullToken:field.nullToken??null};
      if(!positiveDecimal(result.scale))throw fault('FIELD_SCALE_REQUIRED','The source unit scale must be a positive decimal string.');
      if(result.role==='measure'&&(!result.unit||!result.notes))
        throw fault('MEASURE_CONTEXT_REQUIRED','Record the source unit and interpretation notes for every measure.');
      if(result.nullToken!==null&&(!textValue(result.nullToken,1024)||result.nullToken===''))
        throw fault('NULL_TOKEN_INVALID','Use a non-empty explicit string to distinguish source nulls.');
      const observation=record.observations[result.source];
      if(observation.nulls&&observation.emptyStrings&&result.nullToken===null)
        throw fault('NULL_EMPTY_AMBIGUITY','Field '+result.source+' contains both source null and empty strings. Set a distinct null marker.');
      return result;
    });
    const all=[...names],keys=fieldNames(input.keyFields??[],all,'row identity',16);
    const filters=fieldNames(input.filters??[],all,'equality filters'),ranges=fieldNames(input.ranges??[],all,'ranges'),
      sorts=fieldNames(input.sorts??[],all,'sorts');
    if(3+filters.length+4*ranges.length+(sorts.length?1:0)>32)
      throw fault('QUERY_CONTRACT_CAPACITY','The original seller supports at most 32 advertised query parameters.');
    if(ranges.some(name=>fields.find(f=>f.name===name).role==='measure')||
       sorts.some(name=>fields.find(f=>f.name===name).role==='measure'))
      throw fault('MEASURE_STRING_ORDER','Exact monetary strings have lexical ordering in the original query engine. Use the exact comparison view for numerical changes, or omit measure sort/range capabilities.');
    return {fields,keyFields:keys,filters,ranges,sorts,
      notes:label(input.notes??'',16000,false),defaultLimit:integer(input.defaultLimit??50,1,1000,'Default query limit'),
      maxLimit:integer(input.maxLimit??250,1,1000,'Maximum query limit')};
  }
  async function reviewEdition(input) {
    only(input,['id','expectedRevision','fields','keyFields','notes','filters','ranges','sorts','defaultLimit','maxLimit']);
    const record=get('editions',input.id);expected(record,input.expectedRevision);
    if(record.status!=='DRAFT')throw fault('EDITION_ALREADY_READY','Create another edition to change an immutable delivered review.',409);
    const reviewed=reviewFields(input,record);if(reviewed.defaultLimit>reviewed.maxLimit)throw fault('QUERY_LIMIT_ORDER','The default query limit exceeds its maximum.');
    const original={revision:record.revision,fields:record.fields,keyFields:record.keyFields,notes:record.notes,
      filters:record.filters,ranges:record.ranges,sorts:record.sorts,defaultLimit:record.defaultLimit,maxLimit:record.maxLimit,
      savedAt:record.updatedAt};
    const root=pathFor('editions',record.id);await privateDirectory(join(root,'reviews'),true);
    await immutable(join(root,'reviews',record.revision+'.json'),bytes(original));
    record.reviewHistory.push({revision:record.revision,sha256:identity(original),savedAt:original.savedAt});
    record.sourceFields=(record.sourceFields??record.fields).map(field=>reviewed.fields.find(next=>next.source===field.source)??field);
    Object.assign(record,reviewed,{revision:record.revision+1,updatedAt:now(),buildIntent:null});
    await save('editions',record);return editionView(record);
  }
  function projectRow(row,fields) {
    return Object.fromEntries(fields.map(field=>[field.name,row.values[field.source]===null&&field.nullToken!==null?
      field.nullToken:row.values[field.source]]));
  }
  async function streamText(path,produce) {
    const handle=await open(path,'w',0o600);
    try {
      let pending='';
      const emit=async text=>{pending+=text;if(Buffer.byteLength(pending)>=65536){await handle.writeFile(pending);pending='';}};
      await produce(emit);if(pending)await handle.writeFile(pending);await handle.sync();
    } finally {await handle.close();}
  }
  async function nativeDataset(record) {
    if(record.status!=='READY')throw fault('EDITION_NOT_READY','Build this reviewed edition before using the original query engine.',409);
    for(const name of ['dataset.csv','dataset.json']){
      const descriptor=record.files.find(item=>item.name===name);
      if(!descriptor)throw fault('EDITION_FILE_MISSING','The original dataset file is missing.',409);
      await verified(pathFor('editions',record.id),descriptor);
    }
    if(datasets.has(record.id))return datasets.get(record.id);
    const {loadDatasetConfig}=await import('../dataset-handler.mjs');
    const native=await loadDatasetConfig(join(pathFor('editions',record.id),record.files.find(v=>v.name==='dataset.json').relative));
    if(native.describe().snapshot!==record.dataset.snapshot)throw fault('NATIVE_SNAPSHOT_CHANGED','The original dataset snapshot differs from the retained edition.',409);
    if(datasets.size>=2)datasets.delete(datasets.keys().next().value);
    datasets.set(record.id,native);return native;
  }
  async function buildEdition(input) {
    only(input,['id','expectedRevision','requestId']);
    let record=get('editions',input.id);const pin=requestIdentity('editions.build',input);
    if(record.buildIntent?.requestKey===pin.requestKey){
      if(record.buildIntent.inputSha256!==pin.inputSha256)throw fault('REQUEST_ID_CONFLICT','This build request already binds different input.',409);
      if(record.status==='READY')return editionView(record);
    } else {
      expected(record,input.expectedRevision);
      if(record.status!=='DRAFT')throw fault('EDITION_ALREADY_READY','This edition is already immutable.',409);
      reviewFields(record,record);
      record.buildIntent={...pin,id:randomUUID(),reviewRevision:record.revision,createdAt:now()};
      await save('editions',record);
    }
    const capture=await requireCapture(record.captureId,record.captureSha256),root=pathFor('editions',record.id);
    const buildName='build-'+record.buildIntent.id,build=join(root,buildName);
    const readyFile=join(build,'sealed.json');
    if(!await absent(readyFile)){
      const saved=await readJson(readyFile,32*MiB);
      if(saved.id!==record.id||saved.captureSha256!==capture.sha256||identity(saved.buildIntent)!==identity(record.buildIntent))
        throw fault('EDITION_SEAL_CHANGED','The sealed edition differs from its original review.',409);
      for(const descriptor of saved.files)await verified(root,descriptor);
      await save('editions',saved);return editionView(saved);
    }
    await privateDirectory(build,true);
    const csv=await open(join(build,'dataset.csv'),'w',0o600),jsonl=await open(join(build,'rows.jsonl'),'w',0o600);
    const keys=new Map(),duplicateExamples=[];let duplicateKeys=0,rowCount=0,csvBuffer=csvLine(record.fields.map(f=>f.name)),jsonBuffer='';
    try {
      for await(const row of captureRows(capture)){
        for(const field of record.fields)if(field.nullToken!==null&&row.values[field.source]===field.nullToken)
          throw fault('NULL_TOKEN_COLLISION','The null marker for '+field.source+' already occurs in original source values.');
        const values=projectRow(row,record.fields);
        if(record.keyFields.length){
          const key=JSON.stringify(record.keyFields.map(name=>values[name]));
          if(keys.has(key)){duplicateKeys++;if(duplicateExamples.length<20)duplicateExamples.push({key,firstOrdinal:keys.get(key),ordinal:row.ordinal});}
          else keys.set(key,row.ordinal);
        }
        csvBuffer+=csvLine(record.fields.map(f=>values[f.name]));
        jsonBuffer+=JSON.stringify({ordinal:row.ordinal,source:{page:row.page,index:row.index},values})+'\n';rowCount++;
        if(Buffer.byteLength(csvBuffer)>=65536){await csv.writeFile(csvBuffer);csvBuffer='';}
        if(Buffer.byteLength(jsonBuffer)>=65536){await jsonl.writeFile(jsonBuffer);jsonBuffer='';}
      }
      if(csvBuffer)await csv.writeFile(csvBuffer);if(jsonBuffer)await jsonl.writeFile(jsonBuffer);
      await csv.sync();await jsonl.sync();
    } finally {await csv.close();await jsonl.close();}
    const configuration={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name:record.name,
      columns:Object.fromEntries(record.fields.map(field=>[field.name,
        record.observations[field.source].nulls&&field.nullToken===null?{type:'string',nullable:true}:'string'])),
      filters:record.filters,ranges:record.ranges,sorts:record.sorts,defaultLimit:record.defaultLimit,maxLimit:record.maxLimit,
      maxRows:limits.maxRows,maxBytes:Math.min(256*MiB,limits.maxCaptureBytes)};
    const review={schema:'stellar-forge.fiscaldata-review.v1',id:record.id,revision:record.buildIntent.reviewRevision,
      fields:record.fields,keyFields:record.keyFields,notes:record.notes,queryCapabilities:{
        filters:record.filters,ranges:record.ranges,sorts:record.sorts,defaultLimit:record.defaultLimit,maxLimit:record.maxLimit},
      reviewedAt:record.updatedAt,duplicateKeys:{rows:duplicateKeys,examples:duplicateExamples},observations:record.observations};
    const source={schema:'stellar-forge.fiscaldata-edition-source.v1',editionId:record.id,captureId:capture.id,
      captureSha256:capture.sha256,source:capture.source,metadata:capture.metadata,pages:capture.pageRecords,
      consistency:capture.consistency,duplicates:capture.duplicates,review,
      valueRepresentation:'All reported numbers, dates and identifiers remain original strings. Unit and scale are annotations; no conversion, summation, rounding or API field projection changed these rows.',
      interval:{first:capture.pageRecords[0]?.observedAt??null,last:capture.completedAt}};
    await immutable(join(build,'dataset.json'),bytes(configuration));
    await immutable(join(build,'source.json'),bytes(source));await immutable(join(build,'review.json'),bytes(review));
    const readme='# '+record.name+'\n\nThis edition contains '+rowCount+' full-source observations projected locally from Treasury Fiscal Data.\n\n'
      +'Source: '+sourceQuery(capture.source)+'\nCapture SHA-256: '+capture.sha256+'\n\n'
      +'Every numeric value is a string with its original decimal precision. Fields and source-unit interpretation are recorded in review.json. Scales are annotations, not applied conversions. JSON nulls are represented by the reviewed native nullable setting or the explicit null marker; literal source strings remain literal.\n\n'
      +(record.notes?record.notes+'\n\n':'')+'The public source provides no transaction-wide snapshot token. The capture preserves each response and checks totals, metadata and an unchanged first page across its recorded interval. Duplicate source observations remain present; the reviewed key has '+duplicateKeys+' duplicate rows.\n\n'
      +'dataset.csv and dataset.json are consumed directly by the original SF30 dataset loader. rows.jsonl preserves source page and row positions. source.json and review.json retain the complete interpretation and original query. The complete export also carries original response bytes.\n';
    await immutable(join(build,'README.md'),Buffer.from(readme));
    const {loadDatasetConfig}=await import('../dataset-handler.mjs'),native=await loadDatasetConfig(join(build,'dataset.json'));
    const files=[];
    for(const [name,mime] of [['dataset.csv','text/csv; charset=utf-8'],['dataset.json','application/json'],['source.json','application/json'],
      ['rows.jsonl','application/x-ndjson'],['review.json','application/json'],['README.md','text/markdown; charset=utf-8']])
      files.push(await fileDescriptor(root,name,mime,buildName+'/'+name,256*MiB));
    const hash=identity({captureSha256:capture.sha256,review,files:files.map(({relative,...file})=>file),snapshot:native.describe().snapshot});
    record={...record,status:'READY',revision:record.revision+1,updatedAt:now(),builtAt:record.buildIntent.createdAt,
      rowCount,sha256:hash,dataset:native.describe(),files,duplicateKeys:review.duplicateKeys};
    await immutable(readyFile,bytes(record));await syncDirectory(build);await save('editions',record);
    if(datasets.size>=2)datasets.delete(datasets.keys().next().value);datasets.set(record.id,native);
    return editionView(record);
  }
  async function* editionRows(record) {
    if(record.status==='DRAFT'){
      const capture=await requireCapture(record.captureId,record.captureSha256);
      for await(const row of captureRows(capture))yield{ordinal:row.ordinal,source:{page:row.page,index:row.index},values:projectRow(row,record.fields)};
      return;
    }
    const descriptor=record.files.find(item=>item.name==='rows.jsonl'),file=await verified(pathFor('editions',record.id),descriptor);
    const stream=createReadStream(file.path),lines=createInterface({input:stream,crlfDelay:Infinity});let count=0;
    try{
      for await(const line of lines){if(!line)continue;const row=JSON.parse(line);
        if(row.ordinal!==count++||!object(row.values))throw fault('EDITION_ROWS_CHANGED','The retained row index differs from its edition.',409);yield row;}
      if(count!==record.rowCount)throw fault('EDITION_ROWS_CHANGED','The retained row count differs from its edition.',409);
    }finally{lines.close();stream.destroy();}
  }
  async function rowsPage(group,input) {
    only(input,['id','offset','limit']);const record=get(group,input.id),{offset,limit}=pageWindow(input),rows=[];
    const iterator=group==='captures'?captureRows(record):editionRows(record);
    for await(const row of iterator){if(row.ordinal>=offset&&rows.length<limit)rows.push(row);}
    const total=group==='captures'?record.rows:record.rowCount;
    return {fields:group==='captures'?(record.fields??[]):record.fields.map(field=>field.name),rows,offset,total,
      nextOffset:offset+rows.length<total?offset+rows.length:null};
  }
  async function queryEdition(input) {
    only(input,['id','query']);if(!textValue(input.query??'',16384))throw fault('QUERY_INVALID','Use the original dataset query string.');
    const record=get('editions',input.id),native=await nativeDataset(record),context={query:new URLSearchParams(input.query??'')};
    const admission=native.admit(context),response=admission===true?native.handle(context):admission;
    if(response.status!==200)throw fault(response.body?.error?.code??response.body?.error??'DATASET_QUERY_REJECTED',
      typeof response.body?.error?.message==='string'?response.body.error.message:JSON.stringify(response.body),response.status);
    return response.body;
  }


  async function keyedRows(record,keys) {
    const map=new Map();
    for await(const row of editionRows(record)){
      const key=JSON.stringify(keys.map(name=>row.values[name]));
      if(map.has(key))throw fault('COMPARISON_KEY_DUPLICATE','The selected key repeats in '+record.name+' at rows '+map.get(key).ordinal+' and '+row.ordinal+'. Choose the complete row identity; both originals remain retained.',409);
      map.set(key,row);
    }
    return map;
  }
  function measureContext(record,name) {
    const field=record.fields.find(value=>value.name===name);
    return field?.role==='measure'?{unit:field.unit,scale:field.scale,notes:field.notes,source:field.source,label:field.label,nullToken:field.nullToken}:null;
  }
  function missingMeasure(record,name,value) {
    const field=record.fields.find(item=>item.name===name);
    return value===null||value===undefined||(field?.nullToken!==null&&field?.nullToken!==undefined&&value===field.nullToken);
  }
  function numericMeasure(record,name,value) {return !missingMeasure(record,name,value)&&decimalParts(value)!==null;}
  function dateObservations(record,rows,keys,measure) {
    const date=keys.find(name=>record.fields.find(field=>field.name===name)?.role==='date');
    if(!date)return {dateField:null,groups:[],incompatibleDates:rows.size};
    const groupFields=keys.filter(name=>name!==date),groups=new Map();let incompatibleDates=0;
    for(const row of rows.values()){
      const value=row.values[measure],at=row.values[date];
      if(!numericMeasure(record,measure,value))continue;
      const parsed=typeof at==='string'?new Date(at+'T00:00:00Z'):null;
      if(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(at)||!Number.isFinite(parsed?.getTime())||parsed.toISOString().slice(0,10)!==at){incompatibleDates++;continue;}
      const key=JSON.stringify(groupFields.map(name=>row.values[name]));
      let group=groups.get(key);
      if(!group){group={key:Object.fromEntries(groupFields.map(name=>[name,row.values[name]])),rows:0,first:null,last:null};groups.set(key,group);}
      const point={date:at,value,ordinal:row.ordinal};group.rows++;
      if(!group.first||at<group.first.date)group.first=point;
      if(!group.last||at>group.last.date)group.last=point;
    }
    return {dateField:date,groupFields,incompatibleDates,groups:[...groups.values()].map(group=>({...group,
      change:subtractDecimals(group.last.value,group.first.value)}))};
  }
  async function createComparison(input) {
    only(input,['leftEditionId','rightEditionId','keyFields','measureFields','name','requestId']);
    const found=requestExisting('comparisons','comparisons.create',input);
    if(found.record?.status==='READY')return found.record;
    if(!found.record&&records.comparisons.size>=limits.maxComparisons)throw fault('COMPARISON_CAPACITY','Open another workspace for additional comparisons.',409);
    const left=get('editions',input.leftEditionId),right=get('editions',input.rightEditionId);
    if(left.status!=='READY'||right.status!=='READY')throw fault('COMPARISON_EDITIONS_NOT_READY','Choose two immutable READY editions.',409);
    const common=left.fields.map(f=>f.name).filter(name=>right.fields.some(f=>f.name===name));
    const keys=fieldNames(input.keyFields,common,'row identity',16);
    if(!keys.length)throw fault('COMPARISON_KEYS_REQUIRED','Select the source’s full row identity.');
    const measures=fieldNames(input.measureFields??[],common,'exact measures',128);
    if(measures.some(name=>!measureContext(left,name)||!measureContext(right,name)))
      throw fault('COMPARISON_MEASURE_ROLE','Choose measures reviewed explicitly in both editions.');
    let record=found.record??{id:randomUUID(),kind:'comparisons',revision:1,...found.pin,name:label(input.name),
      createdAt:now(),updatedAt:now(),leftEditionId:left.id,rightEditionId:right.id,leftSha256:left.sha256,rightSha256:right.sha256,
      keyFields:keys,measureFields:measures,creation:{action:'comparisons.create',payload:clone(input)},status:'BUILDING',sha256:null,summary:null,files:[]};
    if(!found.record)await save('comparisons',record);
    const root=pathFor('comparisons',record.id);
    if(!await absent(join(root,'sealed.json'))){
      const saved=await readJson(join(root,'sealed.json'),32*MiB);
      if(saved.inputSha256!==record.inputSha256||saved.leftSha256!==left.sha256||saved.rightSha256!==right.sha256)
        throw fault('COMPARISON_SEAL_CHANGED','The comparison seal differs from its original selections.',409);
      for(const f of saved.files)await verified(root,f);await save('comparisons',saved);return saved;
    }
    const leftRows=await keyedRows(left,keys),rightRows=await keyedRows(right,keys),
      names=[...new Set([...left.fields.map(f=>f.name),...right.fields.map(f=>f.name)])];
    const totals=Object.fromEntries(measures.map(name=>{
      const l=measureContext(left,name),r=measureContext(right,name),compatible=l.unit===r.unit&&equalDecimals(l.scale,r.scale);
      return [name,{field:name,compatible,unit:compatible?l.unit:null,scale:compatible?l.scale:null,
        left:l,right:r,leftSum:'0',rightSum:'0',delta:null,leftNumericRows:0,rightNumericRows:0,
        leftNonNumericRows:0,rightNonNumericRows:0,leftMissingRows:0,rightMissingRows:0,participatingRows:0,comparedRows:0,incompatibleRows:0,
        unitIncompatibleRows:0,missingPairRows:0,nonNumericPairRows:0,
        leftObservations:dateObservations(left,leftRows,keys,name),rightObservations:dateObservations(right,rightRows,keys,name),
        aggregation:'Arithmetic sums of the numeric values in each selected row set; this is not a Treasury period total. For stock measures such as debt, use the dated first/last observation and change for the reviewed series.',
        contextNotes:[left.notes,right.notes,l.notes,r.notes].filter((value,index,all)=>value&&all.indexOf(value)===index)}];
    }));
    for(const side of ['left','right'])for(const row of (side==='left'?leftRows:rightRows).values())for(const [name,total] of Object.entries(totals)){
      const value=row.values[name];
      if(missingMeasure(side==='left'?left:right,name,value))total[side+'MissingRows']++;
      else if(numericMeasure(side==='left'?left:right,name,value)){total[side+'Sum']=addDecimals(total[side+'Sum'],value);total[side+'NumericRows']++;}
      else total[side+'NonNumericRows']++;
    }
    const summary={leftRows:leftRows.size,rightRows:rightRows.size,added:0,removed:0,changed:0,unchanged:0,
      fieldChanges:{},measureTotals:totals};
    const allKeys=[...new Set([...leftRows.keys(),...rightRows.keys()])];
    const out=await open(join(root,'rows.jsonl'),'w',0o600),csv=await open(join(root,'changes.csv'),'w',0o600);
    let rowBuffer='',csvBuffer=csvLine(['status',...keys,'field','left','right','exact_delta','unit','scale']);
    try{
      for(let ordinal=0;ordinal<allKeys.length;ordinal++){
        const key=allKeys[ordinal],l=leftRows.get(key),r=rightRows.get(key),changes=[];
        for(const name of names)if(!l||!r||l.values[name]!==r.values[name]){
          const before=l?l.values[name]:undefined,after=r?r.values[name]:undefined;
          if(before===undefined&&after===undefined)continue;
          changes.push({field:name,left:before??null,right:after??null,leftPresent:!!l&&Object.hasOwn(l.values,name),rightPresent:!!r&&Object.hasOwn(r.values,name)});
          summary.fieldChanges[name]=(summary.fieldChanges[name]??0)+1;
        }
        const status=!l?'added':!r?'removed':changes.length?'changed':'unchanged';summary[status]++;
        const deltas={};
        for(const name of measures){
          const total=totals[name],a=l?.values[name],b=r?.values[name];
          if(l&&r){total.comparedRows++;if(total.compatible&&numericMeasure(left,name,a)&&numericMeasure(right,name,b)){
            deltas[name]=subtractDecimals(b,a);total.participatingRows++;
          }else{total.incompatibleRows++;deltas[name]=null;
            if(!total.compatible)total.unitIncompatibleRows++;
            else if(missingMeasure(left,name,a)||missingMeasure(right,name,b))total.missingPairRows++;
            else total.nonNumericPairRows++;
          }}
        }
        const keyValues=Object.fromEntries(keys.map((name,index)=>[name,JSON.parse(key)[index]]));
        const row={ordinal,key:keyValues,status,left:l?.values??null,right:r?.values??null,
          leftOrdinal:l?.ordinal??null,rightOrdinal:r?.ordinal??null,changes,deltas};
        rowBuffer+=JSON.stringify(row)+'\n';
        for(const change of changes)csvBuffer+=csvLine([status,...keys.map(name=>keyValues[name]),change.field,
          change.left,change.right,deltas[change.field]??null,totals[change.field]?.unit??null,totals[change.field]?.scale??null]);
        if(Buffer.byteLength(rowBuffer)>65536){await out.writeFile(rowBuffer);rowBuffer='';}
        if(Buffer.byteLength(csvBuffer)>65536){await csv.writeFile(csvBuffer);csvBuffer='';}
      }
      if(rowBuffer)await out.writeFile(rowBuffer);if(csvBuffer)await csv.writeFile(csvBuffer);await out.sync();await csv.sync();
    }finally{await out.close();await csv.close();}
    for(const total of Object.values(totals)){
      if(!total.leftNumericRows)total.leftSum=null;if(!total.rightNumericRows)total.rightSum=null;
      total.delta=total.compatible&&total.leftSum!==null&&total.rightSum!==null?subtractDecimals(total.rightSum,total.leftSum):null;
    }
    const manifest={schema:'stellar-forge.fiscaldata-comparison.v1',id:record.id,name:record.name,createdAt:record.createdAt,
      left:{id:left.id,name:left.name,sha256:left.sha256,captureSha256:left.captureSha256,fields:left.fields,notes:left.notes},
      right:{id:right.id,name:right.name,sha256:right.sha256,captureSha256:right.captureSha256,fields:right.fields,notes:right.notes},
      keyFields:keys,measureFields:measures,summary,rows:allKeys.length,
      distinction:'Added and removed rows affect selected-row sums. Per-row deltas compare only matching unique keys and compatible reviewed units/scales. Reported values and arithmetic remain decimal strings.'};
    await immutable(join(root,'comparison.json'),bytes(manifest));
    await immutable(join(root,'README.md'),Buffer.from('# '+record.name+'\n\n'+manifest.distinction+'\n\n'+
      'comparison.json retains both immutable edition identities, exact unit/context reviews, row-change counts, sums of selected numeric observations and date-ordered first/last observations. Sums across daily debt observations are not Treasury period totals. rows.jsonl preserves all pairs including unchanged rows. changes.csv is the field-level handoff. JSON preserves missing-field distinctions; CSV uses blank cells for absent values.\n'));
    const files=[];for(const [name,mime]of[['comparison.json','application/json'],['rows.jsonl','application/x-ndjson'],
      ['changes.csv','text/csv; charset=utf-8'],['README.md','text/markdown; charset=utf-8']])files.push(await fileDescriptor(root,name,mime));
    record={...record,status:'READY',error:null,revision:record.revision+1,updatedAt:now(),summary,rowCount:allKeys.length,
      sha256:identity(files),files};
    await immutable(join(root,'sealed.json'),bytes(record));await syncDirectory(root);await save('comparisons',record);return record;
  }
  async function comparisonPage(input) {
    only(input,['id','offset','limit','changesOnly']);
    const record=get('comparisons',input.id),{offset,limit}=pageWindow(input);
    if(record.status!=='READY')throw fault('COMPARISON_NOT_READY','Retry this original comparison creation to complete its retained output.',409);
    if(input.changesOnly!==undefined&&typeof input.changesOnly!=='boolean')throw fault('COMPARISON_FILTER','changesOnly must be true or false.');
    const descriptor=record.files.find(file=>file.name==='rows.jsonl'),source=await verified(pathFor('comparisons',record.id),descriptor);
    const stream=createReadStream(source.path),lines=createInterface({input:stream,crlfDelay:Infinity}),rows=[];let total=0;
    try{for await(const line of lines){if(!line)continue;const row=JSON.parse(line);if(input.changesOnly&&row.status==='unchanged')continue;
      if(total>=offset&&rows.length<limit)rows.push(row);total++;}}
    finally{lines.close();stream.destroy();}
    return {...record,files:fileRecords(record),rows,offset,total,nextOffset:offset+rows.length<total?offset+rows.length:null};
  }


  function exportView(record) {
    const {kind,exportKind,requestKey,inputSha256,files,...rest}=record;
    return {...rest,kind:exportKind,files:fileRecords(record)};
  }
  async function copyExact(source,root,target) {
    if(target.split('/').some(part=>!safeName(part)))throw fault('EXPORT_PATH','Choose an original manifest path.',409);
    const destination=join(root,target);await privateDirectory(join(root,...target.split('/').slice(0,-1)),true);
    if(await absent(destination)){
      const {copyFile,chmod}=await import('node:fs/promises');
      await copyFile(source.path,destination,1);await chmod(destination,0o600);
    }
    const actual=await hashPrivate(destination,Math.max(source.size+1,MiB));
    if(actual.hash!==source.sha256||actual.bytes!==source.size)
      throw fault('EXPORT_SOURCE_CHANGED','A copied delivery file differs from its retained original.',409);
    return {name:target.split('/').at(-1),relative:target,mime:source.mime,sha256:source.sha256,size:source.size};
  }
  async function archive(root,manifest) {
    const names=manifest.map(file=>file.relative).sort();
    if(new Set(names).size!==names.length)throw fault('EXPORT_DUPLICATE_PATH','The complete delivery contains duplicate paths.',409);
    const list=join(root,'.archive-inputs'),temporary=join(root,'.delivery.tar.gz.partial');
    if(await absent(list))await createFile(list,Buffer.from(names.join('\0')+'\0'));
    else if(!(await readPrivate(list,4*MiB)).equals(Buffer.from(names.join('\0')+'\0')))
      throw fault('EXPORT_SELECTION_CHANGED','The retained archive selection changed.',409);
    if(await absent(temporary))await createFile(temporary,Buffer.alloc(0));
    await new Promise((done,reject)=>{
      let stderr='',settled=false;
      const child=spawn('tar',['--format=pax','--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner',
        '--pax-option=delete=atime,delete=ctime','-czf',temporary,'--directory',root,'--null','-T',list],
        {stdio:['ignore','ignore','pipe'],shell:false});
      child.stderr.on('data',chunk=>{if(stderr.length<65536)stderr+=chunk.toString();});
      const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
      const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):done();};
      child.once('error',error=>finish(fault('ARCHIVE_TOOL','The local tar process could not start: '+error.message,500)));
      child.once('close',code=>finish(code===0?null:fault('ARCHIVE_FAILED','The retained complete archive could not finish: '+stderr,500)));
    });
    const {chmod}=await import('node:fs/promises');await chmod(temporary,0o600);
    await rename(temporary,join(root,'delivery.tar.gz'));await syncDirectory(root);
    return fileDescriptor(root,'delivery.tar.gz','application/gzip',undefined,1024*MiB);
  }
  async function groupFiles(group,id,prefix='') {
    let record=get(group,id);
    if(group==='captures')record.files=await captureFiles(record);
    if(group==='editions'&&record.status!=='READY'||group==='comparisons'&&record.status!=='READY')
      throw fault('EXPORT_SOURCE_NOT_READY','Complete this immutable source before exporting it.',409);
    const files=[];
    for(const descriptor of record.files){
      const source=await verified(pathFor(group,id),descriptor);
      files.push({source,target:prefix+descriptor.name});
    }
    if(group==='captures'&&!record.files.some(file=>file.name==='capture.json')){
      const bytesValue=bytes({schema:'stellar-forge.fiscaldata-partial-capture.v1',...captureView(record),
        source:record.source,pageRecords:record.pageRecords,attempts:record.attempts,
        description:'Retained partial source interval at export time; this capture has not been sealed complete.'});
      files.push({data:bytesValue,target:prefix+'partial-capture.json',mime:'application/json'});
    }
    return files;
  }
  async function exportSources(group,id) {
    const record=get(group,id),files=await groupFiles(group,id);
    if(group==='editions')files.push(...await groupFiles('captures',record.captureId,'capture/'));
    if(group==='comparisons'){
      const seen=new Set();
      for(const [label,id]of[['left',record.leftEditionId],['right',record.rightEditionId]]){
        const edition=get('editions',id);files.push(...await groupFiles('editions',id,label+'/edition/'));
        if(!seen.has(edition.captureId)){files.push(...await groupFiles('captures',edition.captureId,'captures/'+edition.captureId+'/'));seen.add(edition.captureId);}
      }
    }
    return files;
  }
  async function finishExport(record,sources,overview) {
    const root=pathFor('exports',record.id);
    if(!await absent(join(root,'sealed.json'))){
      const saved=await readJson(join(root,'sealed.json'),32*MiB);
      if(saved.inputSha256!==record.inputSha256||saved.id!==record.id)
        throw fault('EXPORT_SEAL_CHANGED','The delivery seal differs from its original request.',409);
      for(const descriptor of saved.files)await verified(root,descriptor);
      await save('exports',saved);return exportView(saved);
    }
    const retained=[];
    for(const item of sources){
      if(item.data){
        if(item.target.split('/').some(part=>!safeName(part)))throw fault('EXPORT_PATH','Invalid original export path.',409);
        await privateDirectory(join(root,...item.target.split('/').slice(0,-1)),true);
        await immutable(join(root,item.target),item.data);
        retained.push({name:item.target.split('/').at(-1),relative:item.target,mime:item.mime,
          size:item.data.length,sha256:digest(item.data)});
      }else retained.push(await copyExact(item.source,root,item.target));
    }
    const manifest={schema:'stellar-forge.fiscaldata-export.v1',id:record.id,kind:record.exportKind,
      sourceId:record.sourceId,sourceSha256:record.sourceSha256,createdAt:record.createdAt,
      files:retained.map(file=>({path:file.relative,mime:file.mime,size:file.size,sha256:file.sha256})),
      overview};
    await immutable(join(root,'manifest.json'),bytes(manifest));
    await immutable(join(root,'DELIVERY.md'),Buffer.from('# Fiscal Data delivery\n\n'+overview+'\n\n'+
      'manifest.json lists every delivered source file and its exact byte identity. delivery.tar.gz contains that same selection plus this overview and manifest. Keep the source-unit reviews beside the CSV; scales annotate reported values and are never silently applied.\n'));
    const manifestFile=await fileDescriptor(root,'manifest.json','application/json'),
      overviewFile=await fileDescriptor(root,'DELIVERY.md','text/markdown; charset=utf-8');
    const payload=[...retained,manifestFile,overviewFile];
    let archiveFile;
    if(await absent(join(root,'delivery.tar.gz')))archiveFile=await archive(root,payload);
    else archiveFile=await fileDescriptor(root,'delivery.tar.gz','application/gzip',undefined,1024*MiB);
    // Flat original files can be downloaded directly; nested originals remain complete in the archive.
    record={...record,status:'READY',error:null,revision:record.revision+1,updatedAt:now(),
      sha256:identity({manifest:manifestFile.sha256,archive:archiveFile.sha256}),
      manifest:manifest.files,files:[...retained.filter(file=>!file.relative.includes('/')),manifestFile,overviewFile,archiveFile]};
    await immutable(join(root,'sealed.json'),bytes(record));await syncDirectory(root);await save('exports',record);return exportView(record);
  }
  async function makeExport(input) {
    only(input,['kind','id','requestId']);
    const groups={capture:'captures',edition:'editions',comparison:'comparisons'},group=groups[input.kind];
    if(!group)throw fault('EXPORT_KIND','Choose a capture, edition or comparison.');
    const source=get(group,input.id),found=requestExisting('exports','exports.create',input);
    if(found.record?.status==='READY')return exportView(found.record);
    if(!found.record&&records.exports.size>=limits.maxExports)throw fault('EXPORT_CAPACITY','Open another workspace for more retained exports.',409);
    let record=found.record??{id:randomUUID(),kind:'exports',exportKind:input.kind,revision:1,...found.pin,
      sourceId:source.id,sourceSha256:source.sha256??identity(source),creation:{action:'exports.create',payload:clone(input)},createdAt:now(),updatedAt:now(),status:'BUILDING',sha256:null,files:[]};
    if(!found.record)await save('exports',record);
    if(record.sourceSha256!==(source.sha256??identity(source)))
      throw fault('EXPORT_SOURCE_CHANGED','The selected partial source changed after this export intent. Use a new request ID for its new retained state.',409);
    return finishExport(record,await exportSources(group,source.id),
      'Complete '+input.kind+' '+source.id+'. '+(group==='captures'&&source.status!=='COMPLETE'?
        'This is the retained partial interval with status '+source.status+'.':'The original source selection and complete immutable interpretation are included.'));
  }
  async function configureMerchant(input) {
    only(input,['editionId','origin','path','payment','requestId']);
    const edition=get('editions',input.editionId),found=requestExisting('exports','merchant.configure',input);
    if(found.record?.status==='READY')return exportView(found.record);
    if(!found.record&&records.exports.size>=limits.maxExports)throw fault('EXPORT_CAPACITY','Open another workspace for more retained exports.',409);
    const native=await nativeDataset(edition),{buildDatasetSellerConfig}=await import('../dataset-cli.mjs');
    const seller=await buildDatasetSellerConfig(native,{origin:input.origin,path:input.path,payment:input.payment});
    let record=found.record??{id:randomUUID(),kind:'exports',exportKind:'merchant',revision:1,...found.pin,
      sourceId:edition.id,sourceSha256:edition.sha256,creation:{action:'merchant.configure',payload:clone(input)},createdAt:now(),updatedAt:now(),status:'BUILDING',
      origin:input.origin,path:input.path,payment:clone(input.payment),sha256:null,files:[]};
    if(!found.record)await save('exports',record);
    const sources=await exportSources('editions',edition.id);sources.push({target:'seller.json',data:bytes(seller),mime:'application/json'});
    const output=await finishExport(record,sources,'Original SF30 merchant dataset '+edition.id+
      ' with the operator’s explicit public payment terms. The adjacent dataset.csv, dataset.json, source.json and seller.json are the native publisher inputs. Full captured Treasury responses and reviewed units are included.');
    edition.merchant={id:output.id,sha256:output.sha256,origin:input.origin,path:input.path,configuredAt:record.createdAt};
    // This is a delivery reference; it does not rewrite the sealed source edition or its snapshot.
    await save('editions',edition);return output;
  }
  async function publicDeliveryFiles(root,prefix='delivery') {
    if(await realpath(root)!==root)throw fault('ACQUISITION_PATH','Use the original buyer delivery directory.',409);
    const result=[];
    async function walk(path,parts){
      for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        if(!safeName(entry.name))throw fault('ACQUISITION_FILE_NAME','The original delivery contains an unsupported filename.',409);
        const next=join(path,entry.name),names=[...parts,entry.name];
        if(entry.isDirectory())await walk(next,names);
        else if(entry.isFile()){
          const stat=await lstat(next);if(stat.isSymbolicLink()||stat.nlink!==1)throw fault('ACQUISITION_FILE_IDENTITY','Use the retained original delivery files.',409);
          const h=await hashPrivate(next,256*MiB);
          const mime=entry.name.endsWith('.json')?'application/json':entry.name.endsWith('.csv')?'text/csv; charset=utf-8':
            entry.name.endsWith('.jsonl')?'application/x-ndjson':entry.name.endsWith('.md')?'text/markdown; charset=utf-8':'application/octet-stream';
          result.push({source:{path:next,name:entry.name,mime,sha256:h.hash,size:h.bytes},target:[prefix,...names].join('/')});
        }else throw fault('ACQUISITION_FILE_TYPE','The original delivery must contain regular files and directories.',409);
        if(result.length>20000)throw fault('ACQUISITION_FILE_CAPACITY','The original delivery exceeds the configured export file capacity.',413);
      }
    }
    await walk(root,[]);return result;
  }
  async function retainAcquisition(input) {
    assertId(input.id);
    const session=join(directory,'publisher','sessions',input.id),manifest=join(session,'acquisition-manifest.json'),delivery=join(session,'delivery');
    if(input.manifest!==manifest||input.delivery!==delivery)
      throw fault('ACQUISITION_SOURCE_IDENTITY','The original buyer returned an unexpected retained delivery location.',409);
    const sourceManifest=await hashPrivate(manifest,32*MiB),sources=await publicDeliveryFiles(delivery);
    sources.push({source:{path:manifest,name:'session-manifest.json',mime:'application/json',size:sourceManifest.bytes,sha256:sourceManifest.hash},
      target:'session-manifest.json'});
    const sourceSha256=identity(sources.map(item=>({path:item.target,size:item.source.size,sha256:item.source.sha256})));
    const found=requestExisting('exports','publisher.buyer.export',{requestId:input.id+':'+sourceSha256,id:input.id,sourceSha256});
    if(found.record?.status==='READY')return exportView(found.record);
    if(!found.record&&records.exports.size>=limits.maxExports)throw fault('EXPORT_CAPACITY','The original buyer delivery is retained; use a larger export capacity for its complete archive.',409);
    const record=found.record??{id:randomUUID(),kind:'exports',exportKind:'acquisition',revision:1,...found.pin,
      sourceId:input.id,sourceSha256,creation:{action:'publisher.buyer.export',payload:{id:input.id}},createdAt:now(),updatedAt:now(),status:'BUILDING',sha256:null,files:[]};
    if(!found.record)await save('exports',record);
    return finishExport(record,sources,'Complete original SF88/SF100 buyer acquisition '+input.id+
      '. The native session manifest and every file in its delivered dataset are retained byte for byte. The original buyer engine remains responsible for acquisition, accounting and recovery.');
  }
  async function file(kind,id,name) {
    if(closed)throw fault('WORKSPACE_CLOSED','Reopen the private workspace.',409);
    if(!safeName(name))throw fault('DOWNLOAD_NAME','Choose a manifest-listed file.',404);
    if(kind==='publisher')return serial(()=>publisher.file(id,name));
    const groups={capture:'captures',edition:'editions',comparison:'comparisons',export:'exports'},group=groups[kind];
    if(!group)throw fault('DOWNLOAD_KIND','Choose a retained workspace download.',404);
    const record=get(group,id),descriptors=group==='captures'?await captureFiles(record):record.files;
    const descriptor=descriptors.find(value=>value.name===name);
    if(!descriptor)throw fault('DOWNLOAD_MISSING','This original item has no such retained file.',404);
    return verified(pathFor(group,id),descriptor);
  }
  async function dispatchAction(action,input) {
    switch(action){
      case 'catalog.refresh':only(input,[]);return refreshCatalog();
      case 'sources.save':return saveSource(input);
      case 'sources.probe':return probeSource(input);
      case 'captures.start':return beginCapture(input);
      case 'captures.pause':return captureIntent('pause',input);
      case 'captures.resume':return captureIntent('resume',input);
      case 'captures.cancel':return captureIntent('cancel',input);
      case 'captures.get':{only(input,['id']);const record=get('captures',input.id);return{...captureView(record),source:record.source,
        metadata:record.metadata,pageRecords:record.pageRecords,attempts:record.attempts,duplicates:record.duplicates,
        consistency:record.consistency,files:(await captureFiles(record)).map(({relative,...file})=>file)};}
      case 'captures.rows':return rowsPage('captures',input);
      case 'editions.create':return createEdition(input);
      case 'editions.review':return reviewEdition(input);
      case 'editions.build':return buildEdition(input);
      case 'editions.get':{only(input,['id']);const record=get('editions',input.id);
        const fields=record.status==='DRAFT'?(record.sourceFields??record.fields).map(field=>{
          const selected=record.fields.find(value=>value.source===field.source);return{...(selected??field),included:!!selected};}):record.fields;
        return{...record,fields,files:fileRecords(record)};}
      case 'editions.rows':return rowsPage('editions',input);
      case 'editions.query':return queryEdition(input);
      case 'comparisons.create':return createComparison(input);
      case 'comparisons.get':return comparisonPage(input);
      case 'exports.create':return makeExport(input);
      case 'merchant.configure':return configureMerchant(input);
      default:
        if(typeof action==='string'&&action.startsWith('publisher.'))return publisher.act(action,input);
        throw fault('ACTION_UNKNOWN','Choose an action exposed by this Fiscal Data workspace.',404);
    }
  }
  async function dispatch(action,payload={}) {
    if(closing||closed)throw fault('WORKSPACE_CLOSED','The workspace is draining; reopen it before another action.',409);
    if(!object(payload))throw fault('ACTION_PAYLOAD','Use a JSON object for the action payload.');
    const result=await serial(async()=>{
      try{return await dispatchAction(action,clone(payload));}
      catch(error){
        const group=action==='comparisons.create'?'comparisons':['exports.create','merchant.configure','publisher.buyer.export'].includes(action)?'exports':null;
        if(group){
          const failed=[...records[group].values()].find(value=>value.creation?.action===action&&identity(value.creation.payload)===identity(payload)&&value.status!=='READY');
          if(failed){failed.status='FAILED';failed.error=errorView(error);failed.revision++;failed.updatedAt=now();await save(group,failed).catch(()=>{});}
        }
        throw error;
      }
    });
    return {result,state:await snapshot()};
  }
  async function startWorker() {
    if(closing||closed)throw fault('WORKSPACE_CLOSED','Reopen the original workspace.',409);
    workerEnabled=true;kick();return {running:true};
  }
  async function close() {
    if(closePromise)return closePromise;
    closing=true;workerEnabled=false;controller?.abort();
    closePromise=(async()=>{
      try{
        await workerPromise;await tail.catch(()=>{});await publisher.close();datasets.clear();
      }finally{closed=true;await unlock();}
    })();return closePromise;
  }
  return {snapshot,dispatch,file,startWorker,close};
}
