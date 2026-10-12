// MIT. Capture editions and incident cases under the original native workspace lease.
import { readdir, link, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, sha256, fail, fields, readJson, readBytes, writeJsonSnapshot, writeNew, privateDirectory, syncDirectory } from '../common.mjs';
import { OPERATIONS_MAX_BYTES, normalizeOperationsSelection, validateOperationsCapture, operationsSummary, operationsTables,
  operationId, operationSha, createOperationsCapture, normalizeIncidentEdit, createIncidentRevision, validateIncidentHistory,
  incidentSummary, createOperationsExport, validateOperationsExport, UUID } from './domain.mjs';
import { createOperationsFiles, operationsExportDescriptor, OPERATIONS_FILES } from './report.mjs';
const stamp = () => new Date().toISOString(), maximum = OPERATIONS_MAX_BYTES + 1048576;
async function optional(path, limit = maximum) {
  try { return await readJson(path, limit); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function retain(path, value, limit = maximum) {
  const prior = await optional(path, limit);
  if (prior) { if (canonical(prior) !== canonical(value)) fail('GRPC_OPERATIONS_RETAINED_CONFLICT', 409); return prior; }
  try { await writeJsonSnapshot(path, value, limit); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (canonical(await readJson(path, limit)) !== canonical(value)) fail('GRPC_OPERATIONS_RETAINED_CONFLICT', 409);
  }
  return value;
}
async function retainBytes(path, bytes) {
  try {
    if (sha256(await readBytes(path, bytes.length)) !== sha256(bytes)) fail('GRPC_OPERATIONS_EXPORT_FILE_CHANGED', 409);
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeNew(temporary, bytes);
    try { await link(temporary, path); await syncDirectory(dirname(path)); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (sha256(await readBytes(path, bytes.length)) !== sha256(bytes)) fail('GRPC_OPERATIONS_EXPORT_FILE_CHANGED', 409);
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function page(rows, request = {}, snapshot) {
  const offset = request.offset ?? 0, limit = request.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 250) fail('GRPC_OPERATIONS_PAGE_INVALID');
  snapshot ??= sha256(canonical(rows));
  if (offset && !request.expectedSnapshot) fail('GRPC_OPERATIONS_SNAPSHOT_REQUIRED', 409);
  if (request.expectedSnapshot !== undefined && request.expectedSnapshot !== snapshot) fail('GRPC_OPERATIONS_SNAPSHOT_CHANGED', 409);
  return { total:rows.length, offset, snapshot, items:rows.slice(offset, offset + limit), nextOffset:offset + limit < rows.length ? offset + limit : null };
}
export function createGrpcOperationsWorkspace({ directory, assertHeld, collect }) {
  let marker, cached = null, cachedTables = null;
  const captures = join(directory, 'captures'), cases = join(directory, 'cases'), exports = join(directory, 'exports'),
    imports = join(directory, 'imports'), saves = join(directory, 'saves');
  const held = () => assertHeld();
  async function initialize() {
    held();
    for (const path of [directory,captures,cases,exports,imports,saves]) await privateDirectory(path, true);
    const path = join(directory, 'workspace.json');
    marker = await optional(path,4096);
    if (!marker) marker = await retain(path,{schema:'stellar-forge.grpc-operations-workspace.v1',id:randomUUID(),createdAt:stamp()},4096);
    if (marker.schema !== 'stellar-forge.grpc-operations-workspace.v1' || !UUID.test(marker.id ?? '') || typeof marker.createdAt !== 'string')
      fail('GRPC_OPERATIONS_WORKSPACE_CHANGED',409);
  }
  async function capture(id) {
    held(); operationId(id);
    if (cached?.id === id) return cached;
    cached = validateOperationsCapture(await readJson(join(captures,id+'.json'),maximum)); cachedTables = null;
    if (cached.id !== id) fail('GRPC_OPERATIONS_CAPTURE_CHANGED',409);
    return cached;
  }
  async function captureCreate(body) {
    held(); fields(body,['id','selection'],'GRPC_OPERATIONS_CAPTURE_FIELDS_INVALID');
    const id=operationId(body.id),selection=normalizeOperationsSelection(body.selection),requestSha=sha256(canonical(selection));
    const existing=await optional(join(captures,id+'.json'));
    if(existing) {
      const saved=validateOperationsCapture(existing);
      if(saved.id!==id||saved.selectionSha256!==requestSha) fail('GRPC_OPERATIONS_CAPTURE_ID_REUSED',409);
      return operationsSummary(saved);
    }
    const startedAt=stamp(),records=await collect(selection);
    const saved=createOperationsCapture({id,originWorkspaceId:marker.id,startedAt,capturedAt:stamp(),selection,selectionSha256:requestSha,...records});
    await retain(join(captures,id+'.json'),saved); cached=saved;cachedTables=null;
    return operationsSummary(saved);
  }
  async function captureList(body={}) {
    held();fields(body,['offset','limit','expectedSnapshot'],'GRPC_OPERATIONS_LIST_FIELDS_INVALID');
    const rows=[];
    for(const name of await readdir(captures)) if(name.endsWith('.json')&&UUID.test(name.slice(0,-5)))
      rows.push(operationsSummary(await capture(name.slice(0,-5))));
    rows.sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt)||a.id.localeCompare(b.id));
    return page(rows,body);
  }
  async function captureRead(body) {
    held();fields(body,['id','section','recordId','offset','limit','expectedSnapshot','search','phase','method','revision'],'GRPC_OPERATIONS_READ_FIELDS_INVALID');
    const selected=await capture(body.id),section=body.section??'summary';
    if(body.expectedSnapshot!==undefined&&body.expectedSnapshot!==selected.captureSha256) fail('GRPC_OPERATIONS_SNAPSHOT_CHANGED',409);
    if(section==='summary') return operationsSummary(selected);
    const records=section==='call'?selected.calls:section==='health-observation'?selected.health:section==='source'?selected.revisions:null;
    if(records) {
      const row=records.find(row=>(row.id??row.operation?.id)===body.recordId);
      if(!row) fail('GRPC_OPERATIONS_RECORD_NOT_FOUND',404);
      return {captureId:selected.id,captureSha256:selected.captureSha256,section,record:row};
    }
    cachedTables??=operationsTables(selected);
    if(!Object.hasOwn(cachedTables,section)) fail('GRPC_OPERATIONS_SECTION_INVALID');
    if(body.search!==undefined&&(typeof body.search!=='string'||body.search.length>1000)) fail('GRPC_OPERATIONS_SEARCH_INVALID');
    const search=(body.search??'').toLowerCase(),rows=cachedTables[section].filter(row=>
      (!search||JSON.stringify(row).toLowerCase().includes(search))&&(body.phase===undefined||row.phase===body.phase)&&
      (body.method===undefined||row.method===body.method)&&(body.revision===undefined||row.revision===body.revision));
    return {captureId:selected.id,section,...page(rows,body,selected.captureSha256)};
  }
  async function history(id) {
    operationId(id);const root=join(cases,id);let names;
    try{names=(await readdir(root)).filter(name=>/^\d{10}\.json$/.test(name)).sort();}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
    const rows=[];let retainedBytes=0;
    for(const name of names) {
      const row=await readJson(join(root,name),16*1024*1024);
      if(name!==String(row.version).padStart(10,'0')+'.json') fail('GRPC_INCIDENT_RECORD_CHANGED',409);
      retainedBytes+=Buffer.byteLength(JSON.stringify(row))+1;
      if(retainedBytes>OPERATIONS_MAX_BYTES)fail('GRPC_OPERATIONS_EXPORT_TOO_LARGE',413);
      rows.push(row);
    }
    if(rows.length){if(rows.some(row=>row.id!==id))fail('GRPC_INCIDENT_RECORD_CHANGED',409);validateIncidentHistory(rows,await capture(rows[0].captureId));}
    return rows;
  }
  async function caseRead(body) {
    held();fields(body,['id','version'],'GRPC_INCIDENT_READ_FIELDS_INVALID');const rows=await history(body.id);
    if(!rows.length)fail('GRPC_INCIDENT_NOT_FOUND',404);
    const version=body.version??rows.length;
    if(!Number.isSafeInteger(version)||version<1||version>rows.length)fail('GRPC_INCIDENT_VERSION_INVALID');
    const revision=rows[version-1];
    return {case:incidentSummary(revision),revision,currentVersion:rows.length,currentSha256:rows.at(-1).sha256,
      history:rows.map(incidentSummary),capture:operationsSummary(await capture(revision.captureId))};
  }
  async function caseList(body={}) {
    held();fields(body,['offset','limit','expectedSnapshot','state','severity','search'],'GRPC_INCIDENT_LIST_FIELDS_INVALID');
    if(body.search!==undefined&&(typeof body.search!=='string'||body.search.length>1000))fail('GRPC_INCIDENT_SEARCH_INVALID');
    const rows=[];
    for(const id of await readdir(cases))if(UUID.test(id)){const saved=await history(id);if(saved.length)rows.push(incidentSummary(saved.at(-1)));}
    rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
    return page(rows.filter(row=>(!body.state||row.state===body.state)&&(!body.severity||row.severity===body.severity)&&
      (!body.search||(row.title+' '+row.review.reviewer).toLowerCase().includes(body.search.toLowerCase()))),body);
  }
  async function caseSave(body) {
    held();fields(body,['operationId','id','captureId','expectedVersion','edit'],'GRPC_INCIDENT_SAVE_FIELDS_INVALID');
    operationId(body.operationId);operationId(body.id);
    const selected=await capture(body.captureId),edit=normalizeIncidentEdit(body.edit,selected),rows=await history(body.id);
    if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)fail('GRPC_INCIDENT_VERSION_INVALID');
    const input={operationId:body.operationId,id:body.id,captureId:selected.id,expectedVersion:body.expectedVersion,edit};
    const priorIntent=await optional(join(saves,body.operationId+'.json'),16*1024*1024);
    if(priorIntent&&canonical(priorIntent)!==canonical(input))fail('GRPC_INCIDENT_OPERATION_REUSED',409);
    const earlier=rows.find(row=>row.operationId===body.operationId);
    if(earlier){if(earlier.inputSha256!==sha256(canonical(input)))fail('GRPC_INCIDENT_OPERATION_REUSED',409);return caseRead({id:earlier.id,version:earlier.version});}
    if(rows.length!==body.expectedVersion)fail('GRPC_INCIDENT_VERSION_CHANGED',409);
    if(rows.length&&rows[0].captureId!==selected.id)fail('GRPC_INCIDENT_CAPTURE_CHANGED',409);
    await retain(join(saves,body.operationId+'.json'),input,16*1024*1024);
    const row=createIncidentRevision({...input,authorWorkspaceId:marker.id,capture:selected,history:rows,createdAt:stamp()});
    createOperationsExport(selected,[...rows,row]); // Every saved version remains a complete portable handover.
    const root=await privateDirectory(join(cases,body.id),true);
    await retain(join(root,String(row.version).padStart(10,'0')+'.json'),row,16*1024*1024);
    return caseRead({id:row.id,version:row.version});
  }
  async function bundle(body) {
    const rows=await history(body.id);if(!rows.length)fail('GRPC_INCIDENT_NOT_FOUND',404);
    if(!Number.isSafeInteger(body.version)||body.version<1||body.version>rows.length)fail('GRPC_INCIDENT_VERSION_REQUIRED');
    return createOperationsExport(await capture(rows[0].captureId),rows.slice(0,body.version));
  }
  async function exportCreate(body) {
    held();fields(body,['id','version'],'GRPC_OPERATIONS_EXPORT_FIELDS_INVALID');
    const value=await bundle(body),root=await privateDirectory(join(exports,value.exportSha256),true);
    const completed=await optional(join(root,'files.json'),65536);
    if(completed) {
      if(completed.exportSha256!==value.exportSha256||completed.case?.sha256!==value.history.at(-1).sha256||
        completed.captureSha256!==value.capture.captureSha256)fail('GRPC_OPERATIONS_EXPORT_CHANGED',409);
      return completed;
    }
    const files=createOperationsFiles(value);
    for(const file of files)await retainBytes(join(root,file.path),file.bytes);
    const descriptor=operationsExportDescriptor(value,files);await retain(join(root,'files.json'),descriptor,65536);return descriptor;
  }
  async function download(body) {
    held();fields(body,['exportSha256','file'],'GRPC_OPERATIONS_DOWNLOAD_FIELDS_INVALID');operationSha(body.exportSha256);
    const definition=OPERATIONS_FILES.find(file=>file.path===body.file);if(!definition)fail('GRPC_OPERATIONS_FILE_REQUIRED');
    const root=join(exports,body.exportSha256),descriptor=await readJson(join(root,'files.json'),65536);
    if(descriptor.exportSha256!==body.exportSha256)fail('GRPC_OPERATIONS_EXPORT_CHANGED',409);
    const file=descriptor.files.find(file=>file.path===body.file),bytes=await readBytes(join(root,body.file),definition.maximum);
    if(!file||bytes.length!==file.bytes||sha256(bytes)!==file.sha256)fail('GRPC_OPERATIONS_EXPORT_FILE_CHANGED',409);
    return {filename:body.file,contentType:definition.contentType,bytes,sha256:file.sha256};
  }
  async function receive(body) {
    held();fields(body,['operationId','bundle'],'GRPC_OPERATIONS_RECEIVE_FIELDS_INVALID');
    const id=operationId(body.operationId),value=validateOperationsExport(body.bundle);
    await retain(join(imports,id+'.intent.json'),{operationId:id,exportSha256:value.exportSha256},4096);
    const receipt=join(imports,id+'.json'),completed=await optional(receipt,65536);if(completed)return completed;
    const savedCapture=await optional(join(captures,value.capture.id+'.json'));
    if(savedCapture&&canonical(savedCapture)!==canonical(value.capture))fail('GRPC_OPERATIONS_CAPTURE_ID_CONFLICT',409);
    const caseId=value.history[0].id,existing=await history(caseId);
    for(let index=0;index<Math.min(existing.length,value.history.length);index++)
      if(canonical(existing[index])!==canonical(value.history[index]))fail('GRPC_INCIDENT_HISTORY_DIVERGED',409);
    // Validate every incoming binding and history prefix before publishing. Each
    // newly appended revision is complete and can be reused after interruption.
    await retain(join(captures,value.capture.id+'.json'),value.capture);
    const root=await privateDirectory(join(cases,caseId),true);
    for(const row of value.history.slice(existing.length))await retain(join(root,String(row.version).padStart(10,'0')+'.json'),row,16*1024*1024);
    const result={schema:'stellar-forge.grpc-operations-received.v1',operationId:id,exportSha256:value.exportSha256,
      captureId:value.capture.id,captureSha256:value.capture.captureSha256,caseId,receivedVersion:value.history.length,
      currentVersion:Math.max(existing.length,value.history.length),receiverWorkspaceId:marker.id,receivedAt:stamp()};
    await retain(receipt,result,65536);cached=null;cachedTables=null;return result;
  }
  return {initialize,captureCreate,captureRead,captureList,caseSave,caseRead,caseList,exportCreate,download,receive};
}
