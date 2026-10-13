// MIT. Complete setup receiving through the original runtime Applications writer.
import { open, link, unlink, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  absolute, privateDirectory, makePrivate, regular, readJSON, saveJSON,
  operationLease, operationId, recordId, need, plain, digest, json, canonical, now,
} from './storage.mjs';
import { serializeSetupDocument } from './public/application-setup.mjs';
import { FAMILY_SCHEMA, createSetupDocument, readSetupFile, setupDocumentFamily, setupConfiguration } from './public/application-setup-codec.mjs';

const SCHEMA = 'stellar-forge.application-setup-operation.v1';
const DOCUMENT = 'source-setup.json', NORMALIZED = 'complete-setup.json', BINDINGS = 'host-bindings.json', RECORD = 'operation.json';
const MAX_SETUP = 2 * 1024 * 1024;
const dataDirectory = root => join(root, 'setup');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => digest(json(canonical(value)));
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

async function retainBytes(path, bytes) {
  const temporary = path + '.pending-' + randomUUID();
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  try {
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const saved = await regular(path, Math.max(bytes.length, MAX_SETUP));
      need(saved.equals(bytes), 'APPLICATION_SETUP_OUTPUT_EXISTS', 'Choose a new output path for different setup source.');
    }
  } finally { await unlink(temporary); }
  const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
}
async function localOperation(directory, work, { create = false } = {}) {
  const root = absolute(resolve(directory));
  if (create) {
    try { await makePrivate(root); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await privateDirectory(root);
  const lease = await operationLease(join(root, 'operation.lock'));
  try { return await work(root); }
  finally { await lease.close(); }
}
async function sourceFile(path) {
  const bytes = await regular(absolute(resolve(path)), MAX_SETUP);
  const text = decode(bytes);
  return { bytes, text, sha256: digest(bytes), filename: basename(path) };
}
function rawForm(application, declaration) {
  const values = application.settings ?? {}, names = new Set([
    ...Object.keys(values), ...(declaration?.fields ?? []).map(field => field.name),
  ]);
  return { label: application.label, runtimeId: application.runtimeId, kind: application.kind,
    settings: Object.fromEntries([...names].map(name => {
      const type = declaration?.fields.find(field => field.name === name)?.type;
      const boolean = type === 'boolean' || typeof values[name] === 'boolean';
      return [name, { value: boolean ? 'on' : String(values[name] ?? (type === 'port' ? '0' : '')),
        checked: boolean && values[name] === true }];
    })) };
}
function bindingsValue(value) {
  need(plain(value) && Object.keys(value).every(key => ['label', 'runtimeId', 'settings'].includes(key)),
    'APPLICATION_SETUP_BINDINGS_INVALID', 'Host bindings contain label, runtimeId and an optional complete settings object.');
  if (value.label !== undefined) need(typeof value.label === 'string', 'APPLICATION_SETUP_BINDINGS_INVALID');
  if (value.runtimeId !== undefined) need(typeof value.runtimeId === 'string', 'APPLICATION_SETUP_BINDINGS_INVALID');
  if (value.settings !== undefined) need(plain(value.settings), 'APPLICATION_SETUP_BINDINGS_INVALID');
  return value;
}
function summary(document) {
  const family = setupDocumentFamily(document);
  return { schema: document.schema, id: document.id, title: document.title,
    workspaceId: document.workspaceId, active: family.active, createdAt: document.createdAt, updatedAt: document.updatedAt,
    variants: family.entries.map(entry => ({
      id: entry.id, kind: entry.kind, label: entry.form.label, runtimeId: entry.form.runtimeId,
      applicationId: entry.applicationId, openingRevision: entry.baseRevision,
      fieldNames: Object.keys(entry.form.settings), updatedAt: entry.updatedAt,
    })), receivedFrom: document.receivedFrom, reconciliations: document.reconciliations };
}
export async function inspectApplicationSetup({ document: path }) {
  const source = await sourceFile(path), document = readSetupFile(source.text);
  return { source: { filename: source.filename, bytes: source.bytes.length, sha256: source.sha256 },
    summary: summary(document), document };
}
export async function exportApplicationSetup(model, { applicationId, output, name = '' }) {
  const [workspace, state] = await Promise.all([model.state(), model.applicationsState({ historyLimit: 1 })]);
  const application = state.applications.find(item => item.id === recordId(applicationId));
  need(application && !application.error, 'APPLICATION_SETUP_APPLICATION_UNAVAILABLE', 'Select an available saved application.');
  const declaration = state.catalog.find(item => item.id === application.kind);
  const form = rawForm(application, declaration), contextId = 'application:' + application.id, id = contextId + '/' + application.kind;
  const family = { schema: FAMILY_SCHEMA, workspaceId: workspace.workspaceId, active: id, entries: [{
    workspaceId: workspace.workspaceId, contextId, id, applicationId: application.id,
    kind: application.kind, baseRevision: application.revision, updatedAt: now(),
    baseline: clone(form), form: clone(form), sourceCatalog: clone(declaration ?? null),
    applicationBaseline: { id: application.id, revision: application.revision, label: application.label,
      runtimeId: application.runtimeId, kind: application.kind, settings: clone(application.settings ?? {}) },
  }] };
  const document = createSetupDocument(family, name, { catalog: state.catalog, runtimes: workspace.runtimes });
  const bytes = Buffer.from(serializeSetupDocument(document), 'utf8'), path = absolute(resolve(output));
  await privateDirectory(dirname(path)); await retainBytes(path, bytes);
  return { output: path, bytes: bytes.length, sha256: digest(bytes), summary: summary(document) };
}
async function readOperation(root) {
  const data = dataDirectory(root);
  await privateDirectory(data);
  const record = await readJSON(join(data, RECORD));
  need(record?.schema === SCHEMA && ['DRAFT', 'REVIEWED', 'SAVED'].includes(record.phase) &&
    typeof record.workspaceId === 'string' && typeof record.workspaceDirectory === 'string',
  'APPLICATION_SETUP_OPERATION_INVALID');
  operationId(record.id); operationId(record.saveRequest?.requestId);
  need(record.id === record.saveRequest.requestId, 'APPLICATION_SETUP_REQUEST_CHANGED');
  need(record.source?.file === DOCUMENT && record.document?.file === NORMALIZED && record.bindings?.file === BINDINGS,
    'APPLICATION_SETUP_OPERATION_INVALID');
  const [source, normalized, bindings] = await Promise.all([
    regular(join(data, DOCUMENT), MAX_SETUP), regular(join(data, NORMALIZED), MAX_SETUP), regular(join(data, BINDINGS), MAX_SETUP),
  ]);
  need(source.length === record.source.bytes && digest(source) === record.source.sha256 &&
    normalized.length === record.document.bytes && digest(normalized) === record.document.sha256 &&
    bindings.length === record.bindings.bytes && digest(bindings) === record.bindings.sha256,
  'APPLICATION_SETUP_SOURCE_CHANGED', 'The retained setup or host bindings changed. Prepare a new operation from the intended source.');
  need(hash(record.reviewRequest) === record.reviewRequestSha256,
    'APPLICATION_SETUP_REQUEST_CHANGED', 'The original prepared request changed. Prepare a new operation.');
  if (record.phase !== 'DRAFT') {
    need(record.review && hash(record.review) === record.reviewSha256 &&
      record.review.id === record.saveRequest.reviewId &&
      record.review.applicationId === record.saveRequest.applicationId &&
      record.review.applicationId === record.reviewRequest.applicationId &&
      record.review.previousRevision === record.reviewRequest.expectedRevision &&
      record.review.runtimeId === record.reviewRequest.runtimeId && record.review.kind === record.reviewRequest.kind,
    'APPLICATION_SETUP_REVIEW_CHANGED');
  }
  if (record.phase === 'SAVED') need(record.result?.saved === true && hash(record.result) === record.resultSha256 &&
    record.result.applicationId === (record.reviewRequest.applicationId ?? digest(record.id).slice(0, 24)),
    'APPLICATION_SETUP_RESULT_CHANGED');
  const document = readSetupFile(decode(normalized));
  need(document.id === record.document.id, 'APPLICATION_SETUP_SOURCE_CHANGED');
  return { record, source, document, bindings };
}
async function selectedWorkspace(model, record) {
  const workspace = await model.state();
  need(workspace.workspaceId === record.workspaceId && model.directory === record.workspaceDirectory,
    'APPLICATION_SETUP_WORKSPACE_CHANGED', 'Use the original workspace for this operation, or prepare a receiving operation on the new host.');
  return workspace;
}
function report(root, record) {
  return { schema: record.schema, operationDirectory: root, setupDirectory: dataDirectory(root), operationId: record.id, phase: record.phase,
    workspaceId: record.workspaceId, mode: record.mode, variant: record.variant,
    source: record.source, document: record.document, bindings: record.bindings, reviewRequest: record.reviewRequest,
    review: record.review ?? null, saveRequest: record.saveRequest, result: record.result ?? null,
    lastError: record.lastError ?? null, createdAt: record.createdAt, updatedAt: record.updatedAt };
}
async function retainError(root, record, error) {
  record.lastError = { at: now(), code: error.code ?? 'APPLICATION_SETUP_ERROR', message: String(error.message ?? error) };
  record.updatedAt = now();
  await saveJSON(join(dataDirectory(root), RECORD), record, true);
}
async function materialize(root, record) {
  const data = dataDirectory(root);
  if (record.review) {
    await saveJSON(join(data, 'review.json'), record.review, true);
    await saveJSON(join(data, 'save-request.json'), record.saveRequest, true);
  }
  if (record.result) await saveJSON(join(data, 'result.json'), record.result, true);
}
export async function applicationSetupStatus({ operation: directory }) {
  return localOperation(directory, async root => {
    const { record, document } = await readOperation(root);
    return { ...report(root, record), completeDocument: document };
  });
}
export async function prepareApplicationSetup(model, {
  operation: directory, document: documentPath = null, mode = null, kind = null,
  bindings: bindingsPath = null, requestId = null,
}) {
  return localOperation(directory, async root => {
    let record = await readJSON(join(dataDirectory(root), RECORD), true);
    if (record) {
      ({ record } = await readOperation(root)); await selectedWorkspace(model, record);
      if (documentPath) need((await sourceFile(documentPath)).sha256 === record.source.sha256, 'APPLICATION_SETUP_SOURCE_CHANGED');
      if (bindingsPath) need((await sourceFile(bindingsPath)).sha256 === record.bindings.sha256, 'APPLICATION_SETUP_BINDINGS_CHANGED');
      if (mode) need(mode === record.mode, 'APPLICATION_SETUP_MODE_CHANGED');
      if (kind) need(kind === record.variant.kind, 'APPLICATION_SETUP_VARIANT_CHANGED');
      if (requestId) need(requestId === record.saveRequest.requestId, 'APPLICATION_SETUP_REQUEST_CHANGED');
      if (record.phase !== 'DRAFT') { await materialize(root, record); return report(root, record); }
    } else {
      need(documentPath && ['new', 'reopen'].includes(mode), 'APPLICATION_SETUP_RECEIVING_SELECTION_REQUIRED',
        'Choose the setup document and explicit new or reopen mode for a new operation.');
      const source = await sourceFile(documentPath);
      const [workspace, state] = await Promise.all([model.state(), model.applicationsState({ historyLimit: 1 })]);
      const document = readSetupFile(source.text, { catalog: state.catalog, runtimes: workspace.runtimes });
      const family = setupDocumentFamily(document);
      const variant = kind ? family.entries.find(entry => entry.kind === kind) : family.entries.find(entry => entry.id === family.active);
      need(variant, 'APPLICATION_SETUP_VARIANT_UNAVAILABLE', 'Choose a retained tool variant from this complete setup.');
      const declaration = state.catalog.find(item => item.id === variant.kind);
      need(declaration, 'APPLICATION_SETUP_TOOL_UNAVAILABLE', 'Select a runtime workspace containing this original application provider.');
      const bindingSource = bindingsPath ? await sourceFile(bindingsPath) : {
        bytes: Buffer.from('{}\n'), text: '{}\n', sha256: digest(Buffer.from('{}\n')), filename: BINDINGS,
      };
      const bindings = bindingsValue(JSON.parse(bindingSource.text));
      const input = setupConfiguration(variant.form, { ...document.catalog, [variant.kind]: declaration });
      if (mode === 'new') input.runtimeId = '';
      if (bindings.runtimeId !== undefined) input.runtimeId = bindings.runtimeId;
      if (bindings.label !== undefined) input.label = bindings.label;
      if (bindings.settings !== undefined) input.settings = clone(bindings.settings);
      need(workspace.runtimes.some(runtime => runtime.id === input.runtimeId && runtime.phase === 'READY'),
        'APPLICATION_SETUP_RUNTIME_REQUIRED', 'Select a ready host runtime in the explicit host bindings.');
      if (mode === 'reopen') {
        need(family.workspaceId === workspace.workspaceId && variant.applicationId,
          'APPLICATION_SETUP_ORIGINAL_WORKSPACE_REQUIRED', 'Reopen the saved application in its original workspace, or receive a new application.');
        const saved = state.applications.find(item => item.id === variant.applicationId);
        need(saved && !saved.error, 'APPLICATION_SETUP_APPLICATION_UNAVAILABLE');
        need(saved.revision === variant.baseRevision, 'APPLICATION_REVIEW_CHANGED',
          'Reconcile this draft with the newer saved application in Applications, then export the complete setup.');
      }
      const reviewRequest = { ...input, providerId: declaration.providerId ?? null,
        applicationId: mode === 'reopen' ? variant.applicationId : null,
        expectedRevision: mode === 'reopen' ? variant.baseRevision : null };
      const createdAt = now(), id = operationId(requestId ?? randomUUID());
      const normalized = Buffer.from(serializeSetupDocument(document), 'utf8');
      record = { schema: SCHEMA, id, phase: 'DRAFT', createdAt, updatedAt: createdAt,
        workspaceId: workspace.workspaceId, workspaceDirectory: model.directory, mode,
        variant: { id: variant.id, kind: variant.kind, applicationId: variant.applicationId, openingRevision: variant.baseRevision },
        source: { file: DOCUMENT, filename: source.filename, bytes: source.bytes.length, sha256: source.sha256,
          documentId: document.id, workspaceId: document.workspaceId },
        document: { file: NORMALIZED, id: document.id, bytes: normalized.length, sha256: digest(normalized) },
        bindings: { file: BINDINGS, filename: bindingSource.filename, bytes: bindingSource.bytes.length, sha256: bindingSource.sha256 },
        reviewRequest, reviewRequestSha256: hash(reviewRequest),
        saveRequest: { requestId: id, reviewId: null, applicationId: reviewRequest.applicationId } };
      // Commit the complete receiving source and request together before native review.
      // An interrupted staging directory has never started the native operation.
      const staging = join(root, 'setup.pending-' + randomUUID());
      await makePrivate(staging);
      try {
        await retainBytes(join(staging, DOCUMENT), source.bytes);
        await retainBytes(join(staging, NORMALIZED), normalized);
        await retainBytes(join(staging, BINDINGS), bindingSource.bytes);
        await saveJSON(join(staging, RECORD), record);
        await rename(staging, dataDirectory(root));
        const parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
        try { await parent.sync(); } finally { await parent.close(); }
      } finally { await rm(staging, { recursive: true, force: true }); }
    }
    try {
      const review = await model.applicationsReview(record.reviewRequest);
      record.review = review; record.reviewSha256 = hash(review); record.saveRequest.reviewId = review.id;
      record.phase = 'REVIEWED'; record.updatedAt = now(); delete record.lastError;
      await saveJSON(join(dataDirectory(root), RECORD), record, true);
      await materialize(root, record);
      return report(root, record);
    } catch (error) { await retainError(root, record, error); throw error; }
  }, { create: true });
}
export async function saveApplicationSetup(model, { operation: directory }) {
  return localOperation(directory, async root => {
    const { record } = await readOperation(root); await selectedWorkspace(model, record);
    need(record.phase !== 'DRAFT', 'APPLICATION_SETUP_REVIEW_REQUIRED',
      'Continue application-setup-prepare for this operation, inspect its native review, then save.');
    if (record.phase === 'SAVED') { await materialize(root, record); return report(root, record); }
    try {
      const result = await model.applicationsSave(record.saveRequest);
      need(result?.saved === true && typeof result.applicationId === 'string' && typeof result.revision === 'string',
        'APPLICATION_SETUP_SAVE_RESULT_INVALID');
      record.result = result; record.resultSha256 = hash(result); record.phase = 'SAVED'; record.updatedAt = now(); delete record.lastError;
      await saveJSON(join(dataDirectory(root), RECORD), record, true);
      await materialize(root, record);
      return report(root, record);
    } catch (error) { await retainError(root, record, error); throw error; }
  });
}
