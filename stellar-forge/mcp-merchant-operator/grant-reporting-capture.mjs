// MIT. Original Grant reporting capture through the retained Merchant workspace.
import { createHash } from 'node:crypto';
import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readGrantAgentFile } from '../../stellar/scf_2026/sf47_budget_model/workspace/agent-client.mjs';
import { captureGrantReportingPlan, readGrantReportingCapture } from
  '../../stellar/scf-starforge-20261009/distribution/discovery/grant-reporting-native.mjs';
import { prepareGrantReportingPlan } from
  '../../stellar/scf-starforge-20261009/distribution/discovery/grant-reporting-core.mjs';
import { loadCommandCatalog } from
  '../../stellar/scf-starforge-20261009/distribution/discovery/load.mjs';

export const GRANT_REPORTING_REQUEST_SCHEMA = 'stellar-forge.grant-reporting-agent-request.v1';
export const GRANT_REPORTING_RESULT_SCHEMA = 'stellar-forge.grant-reporting-agent-result.v1';
export const grantReportingCaptureVerbs = new Set([
  'reporting_catalog', 'reporting_capture', 'reporting_capture_inspect', 'reporting_capture_list',
]);
const MAX_INPUT = 32 * 1024 * 1024, MAX_OUTPUT = 96 * 1024 * 1024;
const members = {
  'reporting-preparation.json': ['application/json', MAX_OUTPUT],
  'grant-reporting-plan.json': ['application/json', MAX_INPUT],
  'grant-reporting-plan.html': ['text/html; charset=utf-8', MAX_OUTPUT],
  'grant-reporting-plan.md': ['text/markdown; charset=utf-8', MAX_OUTPUT],
  'grant-procedure.json': ['application/json', 8 * 1024 * 1024],
  'capture.json': ['application/json', MAX_INPUT],
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const copy = value => JSON.parse(JSON.stringify(value));
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function need(condition, code, message, details = {}) {
  if (!condition) throw Object.assign(new Error(message), {code, ...details});
}
function exact(value, keys, label) {
  need(object(value), 'GRANT_REPORTING_INPUT', label + ' must be one complete object.');
  need(Object.keys(value).every(key => keys.includes(key)), 'GRANT_REPORTING_INPUT',
    'Keep the declared ' + label + ' fields.');
}
function identifier(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value),
    'GRANT_REPORTING_REQUEST', 'Use the original reporting capture request ID.');
  return value;
}
function digest(value) {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    'GRANT_REPORTING_INPUT', 'Keep the exact complete original file SHA256.');
  return value;
}
function decode(bytes) {
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
}
async function optional(filename, maximum = MAX_INPUT) {
  try { return await readGrantAgentFile(filename, maximum); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const same = (a, b) => canonical(a) === canonical(b);
const safeBinding = binding => Object.fromEntries(
  ['directory','scenarioFile','pythonExecutable','allowStart','label']
    .filter(key => binding[key] !== undefined).map(key => [key, binding[key]]));
function inputReference(value) {
  exact(value, ['hostInput','snapshotId','transferId','sourceWorkspace'], 'original input reference');
  need(['hostInput','snapshotId','transferId'].filter(key => value[key] !== undefined).length === 1,
    'GRANT_REPORTING_INPUT', 'Select one original host file, snapshot or committed transfer.');
  return copy(value);
}
function selection(args) {
  need(/^operation-[a-f0-9]{32}$/.test(args.caseId || '') &&
    Number.isSafeInteger(args.expectedVersion) && args.expectedVersion > 0,
  'GRANT_REPORTING_CASE', 'Select the original case and reviewed version.');
  exact(args.fields, ['id','savedAt','title','customer','period','owner','receiving',
    'startDate','asOfDate','receivingWorkspace','commandFinderUrl'], 'report fields');
  need(typeof args.fields.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(args.fields.id),
    'GRANT_REPORTING_INPUT', 'Keep the original reporting plan ID.');
  const document = {
    caseId:args.caseId, expectedVersion:args.expectedVersion, fields:copy(args.fields),
    sourceProject:inputReference(args.sourceProject),
    expectedSourceProjectSha256:digest(args.expectedSourceProjectSha256),
    catalog:inputReference(args.catalog), expectedCatalogSha256:digest(args.expectedCatalogSha256),
  };
  need(args.fields.savedAt === undefined || typeof args.fields.savedAt === 'string' &&
    Number.isFinite(Date.parse(args.fields.savedAt)), 'GRANT_REPORTING_INPUT',
    'Keep the original valid reporting plan creation time.');
  if (args.procedureSelection !== undefined) {
    exact(args.procedureSelection, ['actor','note','selectedRevision','parentSourceId',
      'sourceIds','tables','editions','stepLinks'], 'original procedure selection');
    const tables = args.procedureSelection.tables ?? [];
    need(Array.isArray(tables) && tables.every(table => object(table) &&
      ['case-plan','case-source','preceding-procedure'].includes(table.origin)),
    'GRANT_REPORTING_TABLE', 'Select native procedure tables here; supply original local tables through tableInputs.');
    document.procedureSelection = copy(args.procedureSelection);
  }
  if (args.tableInputs !== undefined) {
    need(document.procedureSelection && Array.isArray(args.tableInputs) && args.tableInputs.length <= 256,
      'GRANT_REPORTING_TABLE', 'Select at most 256 original local tables with a procedure selection.');
    const keys = new Set((document.procedureSelection.tables ?? []).map(table => table.key));
    document.tableInputs = args.tableInputs.map(item => {
      exact(item, ['key','input','expectedSha256'], 'original local table');
      need(typeof item.key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item.key) && !keys.has(item.key),
        'GRANT_REPORTING_TABLE', 'Give each selected original table one distinct key.');
      keys.add(item.key);
      return {key:item.key, input:inputReference(item.input), expectedSha256:digest(item.expectedSha256)};
    });
  }
  need(json(document).length <= 1024 * 1024, 'GRANT_REPORTING_INPUT',
    'Keep the reporting request within 1 MiB; retain full source files through their original input references.');
  return document;
}
async function requestRoot(context, requestId) {
  const parent = await context.directory(join(await context.root(), 'reporting-captures'));
  return {parent, path:join(parent, hash(Buffer.from(identifier(requestId))))};
}
async function readRequest(root, workspace, requestId) {
  const raw = await optional(join(root, 'request.json'), 2 * 1024 * 1024);
  need(raw, 'GRANT_REPORTING_NOT_FOUND', 'Choose a retained reporting request from reporting_capture_list.');
  const value = decode(raw);
  need(value.schema === GRANT_REPORTING_REQUEST_SCHEMA && value.workspace === workspace &&
    value.requestId === requestId && value.requestSha256 === hash(Buffer.from(canonical(value.input))) &&
    typeof value.savedAt === 'string' && /^[a-f0-9]{64}$/.test(value.bindingSelectionSha256 || ''),
  'GRANT_REPORTING_REQUEST_CHANGED', 'Keep the original capture request and complete input identity together.');
  return value;
}
function summary(record) {
  return {requestId:record.requestId, requestSha256:record.requestSha256,
    caseId:record.input.caseId, expectedVersion:record.input.expectedVersion,
    planId:record.input.fields.id, savedAt:record.savedAt};
}
async function output(context, record, name, bytes, complete) {
  const snapshot = await context.retain({
    bytes, mediaType:members[name][0], filename:name, status:200,
    ...(members[name][0] === 'application/json' ? {value:decode(bytes)} : {}),
    source:{kind:'grant-reporting-capture', requestId:record.requestId,
      requestSha256:record.requestSha256, complete},
  }, {tool:'merchant_grant_reporting_capture', requestId:record.requestId,
    caseId:record.input.caseId, expectedVersion:record.input.expectedVersion,
    filename:name, complete});
  const {value, arrays, ...reference} = snapshot;
  return {name, snapshot:reference};
}
function selectedSummary(selection) {
  return {case:copy(selection.case), plan:copy(selection.plan), reporting:copy(selection.reporting),
    sourceProject:{id:selection.sourceProject.id, name:selection.sourceProject.name,
      contentSha256:selection.sourceProject.contentSha256,
      tableCount:selection.sourceProject.tables.length}};
}
async function retainedResult(context, root, record) {
  const raw = await optional(join(root, 'result.json'), 2 * 1024 * 1024);
  if (!raw) return null;
  const result = decode(raw);
  need(result.schema === GRANT_REPORTING_RESULT_SCHEMA && result.workspace === record.workspace &&
    result.requestId === record.requestId && result.requestSha256 === record.requestSha256 &&
    result.state === 'COMPLETE' && Array.isArray(result.files),
  'GRANT_REPORTING_RESULT_CHANGED', 'Keep the original completed capture response with its request.');
  return result;
}
async function inspect(context, record, root) {
  const captured = join(root, 'capture');
  const manifest = await optional(join(captured, 'capture.json'));
  if (!manifest) {
    let captureDirectoryExists = false;
    try { captureDirectoryExists = (await lstat(captured)).isDirectory(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const files = [];
    let portable = null;
    for (const name of Object.keys(members).filter(name => name !== 'capture.json')) {
      const bytes = await optional(join(captured, name), members[name][1]);
      if (!bytes) continue;
      if (name === 'reporting-preparation.json') {
        const prepared = await prepareGrantReportingPlan(decode(bytes));
        need(prepared.plan.id === record.input.fields.id && prepared.plan.createdAt === record.savedAt &&
          prepared.selection.case.id === record.input.caseId &&
          prepared.selection.case.version === record.input.expectedVersion,
        'GRANT_REPORTING_RESULT_CHANGED', 'The retained partial preparation belongs to another original request.');
        portable = {planId:prepared.plan.id, planCreatedAt:prepared.plan.createdAt,
          selection:selectedSummary(prepared.selection)};
      }
      files.push(await output(context, record, name, bytes, false));
    }
    return {schema:GRANT_REPORTING_RESULT_SCHEMA, workspace:record.workspace, ...summary(record),
      state:captureDirectoryExists ? 'INCOMPLETE' : 'PREPARED', portable, files,
      recovery:captureDirectoryExists
        ? 'The final capture manifest is absent. Inspect this request again while publication is running. After an interrupted publication, retain any complete preparation through its file read and reopen it in Operating plans or the canonical create command. A new native capture uses a new reviewed request ID and preserves this directory.'
        : 'This original request has no published capture members. Repeat the identical capture call to continue against its original reviewed case and file selection.'};
  }
  const capture = await readGrantReportingCapture(captured);
  need(capture.plan.id === record.input.fields.id && capture.plan.createdAt === record.savedAt &&
    capture.receipt.selection.case.id === record.input.caseId &&
    capture.receipt.selection.case.version === record.input.expectedVersion &&
    capture.preparation.files.sourceProject.sha256 === record.input.expectedSourceProjectSha256 &&
    capture.preparation.files.catalog.sha256 === record.input.expectedCatalogSha256,
  'GRANT_REPORTING_RESULT_CHANGED', 'The complete capture differs from its original reviewed case and source files.');
  const existing = await retainedResult(context, root, record);
  if (existing) {
    const expected = new Map([...capture.receipt.files, {name:'capture.json', bytes:manifest.length, sha256:hash(manifest)}]
      .map(file => [file.name, file]));
    need(existing.files.length === expected.size, 'GRANT_REPORTING_RESULT_CHANGED',
      'The retained response must include every complete capture member.');
    for (const file of existing.files) {
      const original = expected.get(file.name);
      need(original && file.snapshot?.retention?.state === 'COMPLETE' && file.snapshot?.id &&
        file.snapshot.file.sha256 === original.sha256 && file.snapshot.file.bytes === original.bytes,
      'GRANT_REPORTING_RESULT_CHANGED', 'The retained output differs from the complete original capture.');
      expected.delete(file.name);
      const retained = await context.loadRetained(file.snapshot.id, original.sha256);
      need(retained.bytes.length === original.bytes && hash(retained.bytes) === original.sha256,
        'GRANT_REPORTING_RESULT_CHANGED', 'The complete retained output bytes changed.');
    }
    return existing;
  }
  const files = [];
  for (const file of capture.receipt.files) {
    const bytes = await readGrantAgentFile(join(captured, file.name), members[file.name][1]);
    need(bytes.length === file.bytes && hash(bytes) === file.sha256, 'GRANT_REPORTING_RESULT_CHANGED',
      'The capture member changed while retaining its original response.');
    files.push(await output(context, record, file.name, bytes, true));
  }
  files.push(await output(context, record, 'capture.json', manifest, true));
  const result = {schema:GRANT_REPORTING_RESULT_SCHEMA, workspace:record.workspace, ...summary(record),
    state:files.every(file => file.snapshot.retention?.state === 'COMPLETE') ? 'COMPLETE' : 'RETENTION_INCOMPLETE',
    selection:selectedSummary(capture.receipt.selection),
    capture:{capturedAt:capture.receipt.capturedAt, planId:capture.plan.id,
      planCreatedAt:capture.plan.createdAt, native:{selectionSha256:capture.receipt.native.selectionSha256,
        source:copy(capture.receipt.native.source), closed:{state:capture.receipt.native.closed.state,
          originalInstanceId:capture.receipt.native.closed.originalInstanceId}},
      procedure:capture.receipt.procedure ? {editionId:capture.receipt.procedure.editionId,
        selectedRevision:capture.receipt.procedure.selectedRevision} : null}, files};
  if (result.state !== 'COMPLETE') return {...result,
    recovery:'The original capture is complete. Restore retained storage and use reporting_capture_inspect with this same request ID to publish its full response.'};
  try { await context.immutable(join(root, 'result.json'), json(result)); }
  catch (error) {
    if (error.code !== 'GRANT_RETAINED_CONFLICT') throw error;
    // Another reader retained this same complete source first. Its returned IDs own the request.
    return inspect(context, record, root);
  }
  return result;
}
async function capture(context, args) {
  const input = selection(args), {path:root} = await requestRoot(context, args.requestId);
  await context.directory(root);
  const proposed = {schema:GRANT_REPORTING_REQUEST_SCHEMA, workspace:args.workspace,
    requestId:args.requestId, requestSha256:hash(Buffer.from(canonical(input))), input,
    savedAt:input.fields.savedAt === undefined ? new Date().toISOString() : input.fields.savedAt,
    bindingSelectionSha256:context.binding.selectionSha256};
  try { await context.immutable(join(root, 'request.json'), json(proposed)); }
  catch (error) {
    if (error.code !== 'GRANT_RETAINED_CONFLICT') throw error;
  }
  const record = await readRequest(root, args.workspace, args.requestId);
  need(same(record.input, input), 'GRANT_REPORTING_REQUEST_CONFLICT',
    'This capture request already owns another original selection. Inspect its retained result, or use a new reviewed request for changed fields.');
  if (await optional(join(root, 'capture', 'capture.json'))) return inspect(context, record, root);
  try {
    const stat = await lstat(join(root, 'capture'));
    need(stat.isDirectory() && !stat.isSymbolicLink(), 'GRANT_REPORTING_RESULT_CHANGED',
      'Keep the original capture directory with this retained request.');
    return inspect(context, record, root);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  need(record.bindingSelectionSha256 === context.binding.selectionSha256, 'GRANT_REPORTING_BINDING_CHANGED',
    'The host workspace selection changed after this request was retained. Inspect its original result, then use a newly reviewed request for the current host selection.');
  const inputsDirectory = await context.directory(join(root, 'inputs'));
  const retainInput = async (selection, expected, filename) => {
    const loaded = await context.load(selection, expected);
    need(loaded.bytes.length <= MAX_INPUT && hash(loaded.bytes) === expected,
      'GRANT_REPORTING_INPUT_CHANGED', 'Retain every complete original input byte.');
    const originalName = loaded.metadata.name ?? loaded.metadata.filename ?? filename;
    need(typeof originalName === 'string' && originalName.length > 0 && originalName.length <= 240 &&
      !/[\x00-\x1f\x7f\\/]/.test(originalName) && !['.','..'].includes(originalName),
    'GRANT_REPORTING_INPUT', 'Keep a plain original input filename without directory components.');
    const selectedDirectory = await context.directory(join(inputsDirectory, filename));
    const path = join(selectedDirectory, originalName);
    await context.immutable(path, loaded.bytes);
    return path;
  };
  const sourceProjectFile = await retainInput(input.sourceProject, input.expectedSourceProjectSha256, 'source-project.json');
  const catalogFile = await retainInput(input.catalog, input.expectedCatalogSha256, 'toolkit-catalog.json');
  const procedureSelection = input.procedureSelection ? copy(input.procedureSelection) : undefined;
  if (input.tableInputs) {
    procedureSelection.tables = [...(procedureSelection.tables ?? [])];
    for (let index = 0; index < input.tableInputs.length; index++) {
      const table = input.tableInputs[index];
      const file = await retainInput(table.input, table.expectedSha256, 'table-' + index + '.json');
      procedureSelection.tables.push({key:table.key, origin:'local-original', file});
    }
  }
  try {
    await captureGrantReportingPlan({
      binding:safeBinding(context.binding), caseId:input.caseId, expectedVersion:input.expectedVersion,
      sourceProjectFile, catalogFile, directory:join(root, 'capture'),
      fields:{...input.fields, savedAt:record.savedAt}, ...(procedureSelection ? {procedureSelection} : {}),
    });
  } catch (error) {
    if (error.code === 'EEXIST' || error.code === 'REPORTING_CAPTURE_EXISTS' ||
      error.code === 'REPORTING_CAPTURE_WRITE') {
      const retained = await inspect(context, record, root);
      return {...retained, publication:{code:error.code, message:error.message}};
    }
    throw Object.assign(error, {requestId:args.requestId,
      recovery:'Retain this original request ID and its exact fields. Inspect it before retrying after a lost response.'});
  }
  return inspect(context, record, root);
}
export async function executeGrantReportingCaptureTool(verb, args, context) {
  need(grantReportingCaptureVerbs.has(verb), 'GRANT_REPORTING_TOOL', 'Choose an original reporting capture operation.');
  if (verb === 'reporting_catalog') {
    const catalog = await loadCommandCatalog(), bytes = json(catalog);
    need(bytes.length <= MAX_INPUT, 'GRANT_REPORTING_CATALOG_SIZE',
      'The complete installed catalog exceeds the original source-file bound.');
    return context.retain({bytes, value:catalog, mediaType:'application/json',
      filename:'toolkit-catalog.json', status:200, source:{kind:'installed-command-catalog'}},
    {tool:'merchant_grant_reporting_catalog'});
  }
  if (verb === 'reporting_capture_list') {
    const offset = args.offset ?? 0, limit = args.limit ?? 20;
    need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
      'GRANT_REPORTING_PAGE', 'Select a nonnegative offset and one through 100 retained requests.');
    const parent = await context.directory(join(await context.root(), 'reporting-captures'));
    const names = (await readdir(parent)).filter(name => /^[a-f0-9]{64}$/.test(name)).sort();
    const requests = [];
    for (const key of names.slice(offset, offset + limit)) {
      const root = join(parent, key), raw = await optional(join(root, 'request.json'), 2 * 1024 * 1024);
      if (!raw) {requests.push({captureKey:key, state:'PREPARING'}); continue;}
      const candidate = decode(raw), record = await readRequest(root, args.workspace, candidate.requestId);
      need(key === hash(Buffer.from(record.requestId)), 'GRANT_REPORTING_REQUEST_CHANGED',
        'The retained request directory belongs to another identity.');
      const result = await retainedResult(context, root, record);
      const manifest = await optional(join(root, 'capture', 'capture.json'));
      requests.push({...summary(record), state:result ? 'COMPLETE' : manifest ? 'CAPTURED' : 'PREPARED'});
    }
    return {workspace:args.workspace, offset, count:names.length, requests,
      nextOffset:offset + limit < names.length ? offset + limit : null};
  }
  identifier(args.requestId);
  if (verb === 'reporting_capture_inspect') {
    const {path:root} = await requestRoot(context, args.requestId);
    return inspect(context, await readRequest(root, args.workspace, args.requestId), root);
  }
  const input = selection(args), key = args.workspace + '\0' + args.requestId,
    inputSha256 = hash(Buffer.from(canonical(input))), pending = context.pending.get(key);
  if (pending) {
    need(pending.inputSha256 === inputSha256, 'GRANT_REPORTING_REQUEST_CONFLICT',
      'The running capture request already owns a different original selection.');
    return pending.promise;
  }
  const promise = capture(context, args);
  context.pending.set(key, {inputSha256, promise});
  try {return await promise;} finally {context.pending.delete(key);}
}
