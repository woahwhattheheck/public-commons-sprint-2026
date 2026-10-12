// MIT. Exact operator requests retained inside the original Datasette workspace.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory, readJson, atomicJson, identity, digest, bytes, fault, stamp } from '../postgres/publisher/files.mjs';

export const DATASETTE_REQUEST_SCHEMA = 'stellar-forge.datasette-request.v1';
export const DATASETTE_REQUEST_OPERATIONS = Object.freeze([
  'source.select', 'publisher.plan', 'publisher.review', 'publisher.prepare-buyer',
]);
const OPERATIONS = new Set(DATASETTE_REQUEST_OPERATIONS);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAXIMUM = 16 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function clone(value) {
  const seen = new Set();
  const encoded = JSON.stringify(value, function(key, item) {
    if (typeof item === 'number' && !Number.isFinite(item) ||
        ['undefined', 'bigint', 'function', 'symbol'].includes(typeof item))
      throw fault('DATASETTE_REQUEST_JSON_INVALID');
    if (item && typeof item === 'object') {
      while (seen.size && !seen.has(this)) seen.delete([...seen].at(-1));
      if (seen.has(item)) throw fault('DATASETTE_REQUEST_JSON_INVALID');
      seen.add(item);
    }
    return item;
  });
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAXIMUM)
    throw fault('DATASETTE_REQUEST_LIMIT');
  return JSON.parse(encoded);
}
function requestId(value) {
  if (!UUID.test(value ?? '')) throw fault('DATASETTE_REQUEST_ID_INVALID', 'Retain a version-four UUID before submitting this action.');
  return value;
}
function selectionHash(value) { return value === null ? null : identity(value); }
function rejected(issue) {
  return Number.isInteger(issue?.status) && [400,404,409,413,415,422].includes(issue.status) &&
    typeof issue.code === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(issue.code) &&
    !issue.uncertain && !/CLOSED|INTERRUPTED|CANCELLED|ABORT|PRIVATE_JSON|RECEIPT_INVALID|RECORD_INVALID|OUTCOME_PENDING/.test(issue.code);
}
function savedError(issue) {
  return { code: issue.code, message: typeof issue.message === 'string' ? issue.message.slice(0,4000) : issue.code,
    status: issue.status };
}
function throwSaved(record) {
  const issue = fault(record.error.code, record.error.message, record.error.status);
  issue.requestId = record.requestId; issue.requestHash = record.requestHash;
  issue.requestState = 'REJECTED'; throw issue;
}

/** This helper uses the already acquired workspace lease. It neither opens a
 * second publisher nor creates another operation dispatcher. */
export async function openDatasetteRequests({ directory, workspaceId }) {
  const root = join(directory, 'requests');
  await privateDirectory(root, true);
  async function read(id, missing = false) {
    id = requestId(id);
    let value;
    try { value = await readJson(join(root, id + '.json'), MAXIMUM); }
    catch (issue) { if (missing && issue.code === 'ENOENT') return null;
      if (issue.code === 'ENOENT') throw fault('DATASETTE_REQUEST_NOT_FOUND', 'This workspace has not accepted that request.', 404);
      throw issue; }
    if (!object(value) || value.schema !== DATASETTE_REQUEST_SCHEMA ||
        value.workspaceId !== workspaceId || value.requestId !== id || !OPERATIONS.has(value.operation) ||
        !object(value.input) || value.input.requestId !== id ||
        value.requestHash !== digest(bytes({ operation: value.operation, input: value.input })) ||
        !object(value.prepared) || value.preparedHash !== digest(bytes(value.prepared)) ||
        !['PENDING','COMPLETE','REJECTED'].includes(value.state))
      throw fault('DATASETTE_REQUEST_RECORD_INVALID', 'Read the complete retained original request.');
    if (value.state === 'COMPLETE' && value.resultHash !== digest(bytes(value.result)) ||
        value.state === 'REJECTED' && (!object(value.error) || !rejected(value.error)))
      throw fault('DATASETTE_REQUEST_RECORD_INVALID');
    return value;
  }
  async function save(record) {
    if (bytes(record).length > MAXIMUM) throw fault('DATASETTE_REQUEST_LIMIT');
    await atomicJson(root, record.requestId + '.json', record);
    return record;
  }
  function view(record) {
    return { schema: DATASETTE_REQUEST_SCHEMA, workspaceId, requestId: record.requestId,
      operation: record.operation, input: clone(record.input), requestHash: record.requestHash,
      state: record.state, createdAt: record.createdAt, completedAt: record.completedAt ?? null,
      result: record.state === 'COMPLETE' ? clone(record.result) : null,
      error: record.state === 'REJECTED' ? clone(record.error) : null,
      ...(record.originDirectory !== directory ? { receiving: {
        originDirectory: record.originDirectory, directory,
        note: 'The original input and result retain their sender paths; retained files use this received workspace directory.',
      } } : {}) };
  }
  async function inspect(input = {}) { return view(await read(input.requestId)); }
  async function all() {
    const entries = await readdir(root, { withFileTypes: true });
    const values = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.json$/.test(entry.name)) continue;
      values.push(await read(entry.name.slice(0,-5)));
      if (values.length > 100000) throw fault('DATASETTE_REQUEST_HISTORY_LIMIT');
    }
    return values.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId));
  }
  async function list(input = {}) {
    const offset = input.offset ?? 0, limit = input.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 250)
      throw fault('DATASETTE_REQUEST_PAGE_INVALID');
    const values = (await all()).reverse();
    return { schema: 'stellar-forge.datasette-request-list.v1', workspaceId,
      requests: values.slice(offset,offset+limit).map(value => ({
        requestId:value.requestId,operation:value.operation,requestHash:value.requestHash,state:value.state,
        createdAt:value.createdAt,completedAt:value.completedAt ?? null,
      })), page: { offset,limit,total:values.length,next:offset+limit<values.length?offset+limit:null,
        previous:offset>0?Math.max(0,offset-limit):null } };
  }
  async function complete(record, result) {
    const selected = clone(result);
    await save({ ...record, state:'COMPLETE', completedAt:stamp(),
      result:selected,resultHash:digest(bytes(selected)),error:null });
    return selected;
  }
  async function refuse(record, issue) {
    const error = savedError(issue);
    await save({ ...record,state:'REJECTED',completedAt:stamp(),error,result:null });
  }
  async function resolveSelection(record, { readSelection, writeSelection, signal }) {
    const before = await readSelection(), currentHash = selectionHash(before);
    const prepared = record.prepared;
    if (!object(prepared.declaration) ||
        prepared.declarationHash !== selectionHash(prepared.declaration) ||
        !(prepared.beforeHash === null || HASH.test(prepared.beforeHash ?? '')))
      throw fault('DATASETTE_REQUEST_RECORD_INVALID');
    if (currentHash !== prepared.declarationHash) {
      if (currentHash !== prepared.beforeHash)
        throw fault('DATASETTE_SELECTION_CHANGED', 'A later source selection is already saved. Read the current selection before preparing a new request.', 409);
      signal?.throwIfAborted();
      await writeSelection(prepared.declaration);
    }
    return { ...prepared.declaration, reused:prepared.beforeHash === prepared.declarationHash };
  }
  async function settleSelections(context) {
    for (const record of await all()) {
      if (record.state !== 'PENDING' || record.operation !== 'source.select') continue;
      let result;
      try { result = await resolveSelection(record,context); }
      catch (issue) {
        if (!rejected(issue)) throw issue;
        await refuse(record,issue); continue;
      }
      // A result-receipt write may fail after the source selection was committed.
      // Keep the accepted original request resumable in that case.
      await complete(record,result);
    }
  }
  async function run(operation, input, { prepare, execute, readSelection, writeSelection, signal } = {}) {
    if (!OPERATIONS.has(operation) || input.requestId === undefined) return execute(null);
    const id = requestId(input.requestId), exactInput = clone(input);
    const requestHash = digest(bytes({operation,input:exactInput}));
    let record = await read(id,true);
    if (record && (record.operation !== operation || record.requestHash !== requestHash))
      throw fault('DATASETTE_REQUEST_CHANGED', 'Use the same original action and exact input for this request UUID.', 409);
    if (!record) {
      const prepared = clone(await prepare(exactInput));
      record = {schema:DATASETTE_REQUEST_SCHEMA,workspaceId,requestId:id,operation,input:exactInput,
        requestHash,originDirectory:directory,createdAt:stamp(),state:'PENDING',
        prepared,preparedHash:digest(bytes(prepared)),result:null,error:null};
      await save(record);
    }
    if (record.state === 'COMPLETE') return clone(record.result);
    if (record.state === 'REJECTED') throwSaved(record);
    let result;
    try {
      signal?.throwIfAborted();
      result = operation === 'source.select' ?
        await resolveSelection(record,{readSelection,writeSelection,signal}) : await execute(record);
    } catch (issue) {
      if (rejected(issue)) {
        try { await refuse(record,issue); }
        catch (saveIssue) { const pending=fault('DATASETTE_REQUEST_OUTCOME_PENDING','The original request is retained; reopen it after storage recovers.',503);
          pending.requestId=id;pending.uncertain=true;pending.cause=saveIssue;throw pending; }
        throwSaved({...record,error:savedError(issue)});
      }
      if (issue && typeof issue === 'object') { issue.requestId=id;issue.requestHash=requestHash;issue.uncertain=true; }
      throw issue;
    }
    try { return await complete(record,result); }
    catch (cause) {
      const issue = fault('DATASETTE_REQUEST_OUTCOME_PENDING','The native result exists; reopen this exact retained request after storage recovers.',503);
      issue.requestId=id;issue.requestHash=requestHash;issue.uncertain=true;issue.cause=cause;throw issue;
    }
  }
  return Object.freeze({inspect,list,run,settleSelections,selectionHash});
}
