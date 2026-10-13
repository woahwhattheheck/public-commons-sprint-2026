// MIT. Complete Grant Operations case and Applications setup handoff.
import { open, link, unlink, rename, rm, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  absolute, privateDirectory, makePrivate, regular, readJSON, saveJSON,
  operationLease, operationId, recordId, need, plain, digest, json, canonical, now,
} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { inspectMerchantRuntime } from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import {
  exportApplicationSetup, prepareApplicationSetup,
  saveApplicationSetup, applicationSetupStatus,
} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-setup-operations.mjs';
import {
  FAMILY_SCHEMA, createSetupDocument, readSetupFile, setupDocumentFamily,
} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/public/application-setup-codec.mjs';

export const GRANT_HANDOFF_SCHEMA = 'stellar-forge.grant-application-handoff.v1';
export const GRANT_NATIVE_HANDOFF_SCHEMA = 'stellar-forge.native-grant-application-handoff.v1';
export const GRANT_HANDOFF_OPERATION_SCHEMA = 'stellar-forge.grant-application-handoff-operation.v1';
export const GRANT_HANDOFF_MAX_BYTES = 48 * 1024 * 1024;
const MAX_CASE = 32 * 1024 * 1024, MAX_SETUP = 2 * 1024 * 1024;
const NATIVE = 'stellar/scf_2026/sf47_budget_model/workspace';
const PACKAGE = 'grant-handoff.json';
const hash = value => digest(json(canonical(value)));
const clone = value => JSON.parse(JSON.stringify(value));
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

function exact(value, allowed, required = allowed) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'GRANT_HANDOFF_INPUT_INVALID');
  return value;
}
function text(value, name, maximum = 300) {
  need(typeof value === 'string' && value.trim() && value.length <= maximum && !value.includes('\0'),
    'GRANT_HANDOFF_INPUT_INVALID', 'Use the complete ' + name + '.');
  return value;
}
function caseId(value) {
  need(typeof value === 'string' && /^operation-[a-f0-9]{32}$/.test(value), 'GRANT_HANDOFF_CASE_REQUIRED');
  return value;
}
function version(value) {
  need(Number.isSafeInteger(value) && value >= 1 && value <= 10000000, 'GRANT_HANDOFF_CASE_VERSION_REQUIRED');
  return value;
}
function boolean(value, name) {
  need(typeof value === 'boolean', 'GRANT_HANDOFF_INPUT_INVALID', name + ' must be an explicit boolean.');
  return value;
}
async function optionalFile(path, maximum) {
  try { return await regular(path, maximum); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function retainBytes(path, bytes) {
  const temporary = path + '.pending-' + randomUUID();
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need((await regular(path, GRANT_HANDOFF_MAX_BYTES)).equals(bytes), 'GRANT_HANDOFF_FILE_EXISTS',
        'The original handoff path already contains different source.');
    }
  } finally { await unlink(temporary); }
  await syncDirectory(dirname(path));
}
async function localOperation(directory, action, create = false) {
  const root = absolute(resolve(directory));
  if (create) {
    try { await makePrivate(root); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await privateDirectory(root);
  const lease = await operationLease(join(root, 'operation.lock'));
  try { return await action(root); } finally { await lease.close(); }
}
function bytesRecord(filename, bytes, mediaType) {
  return { filename, mediaType, bytes: bytes.length, sha256: digest(bytes), contentBase64: bytes.toString('base64') };
}
function originalBytes(value, maximum, mediaType) {
  exact(value, ['filename', 'mediaType', 'bytes', 'sha256', 'contentBase64']);
  text(value.filename, 'original filename', 240);
  need(!/[\\/\x00-\x1f\x7f]/.test(value.filename) && !['.', '..'].includes(value.filename),
    'GRANT_HANDOFF_FILENAME_INVALID');
  need(value.mediaType === mediaType && Number.isSafeInteger(value.bytes) && value.bytes > 0 &&
    value.bytes <= maximum && /^[a-f0-9]{64}$/.test(value.sha256 ?? '') &&
    typeof value.contentBase64 === 'string' && value.contentBase64.length <= Math.ceil(maximum / 3) * 4,
  'GRANT_HANDOFF_FILE_INVALID');
  const bytes = Buffer.from(value.contentBase64, 'base64');
  need(bytes.length === value.bytes && bytes.toString('base64') === value.contentBase64 &&
    digest(bytes) === value.sha256, 'GRANT_HANDOFF_FILE_CHANGED');
  return bytes;
}
function checkedPackage(value) {
  exact(value, ['schema', 'id', 'createdAt', 'name', 'source', 'files']);
  need([GRANT_HANDOFF_SCHEMA, GRANT_NATIVE_HANDOFF_SCHEMA].includes(value.schema), 'GRANT_HANDOFF_PACKAGE_INVALID');
  operationId(value.id); text(value.name, 'handoff name');
  need(typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)),
    'GRANT_HANDOFF_PACKAGE_INVALID');
  exact(value.files, ['case', 'setup']);
  const caseBytes = originalBytes(value.files.case, MAX_CASE, 'application/zip');
  const setupBytes = originalBytes(value.files.setup, MAX_SETUP, 'application/json');
  const setup = readSetupFile(decode(setupBytes)), family = setupDocumentFamily(setup);
  const selected = family.entries.find(entry => entry.id === family.active);
  if (value.schema === GRANT_NATIVE_HANDOFF_SCHEMA) {
    exact(value.source, ['kind']);
    need(value.source.kind === 'native-archive' && family.entries.length === 1 &&
      selected?.kind === 'grant-workspace' && selected.applicationId === null && selected.baseRevision === null,
    'GRANT_HANDOFF_NATIVE_SETUP_INVALID');
    return { document: value, caseBytes, setupBytes, setup };
  }
  const source = exact(value.source, ['workspaceId', 'applicationId', 'applicationRevision', 'runtimeId',
    'runtime', 'nativeSelectionSha256', 'nativeSource', 'case']);
  exact(source.case, ['id', 'version', 'mode', 'planId', 'planRevision']);
  caseId(source.case.id); version(source.case.version);
  need(['OPERATIONS', 'WALKTHROUGH'].includes(source.case.mode) &&
    /^plan-[a-f0-9]{32}$/.test(source.case.planId ?? '') &&
    Number.isSafeInteger(source.case.planRevision) && source.case.planRevision >= 1 &&
    /^[a-f0-9]{64}$/.test(source.nativeSelectionSha256 ?? ''),
  'GRANT_HANDOFF_PACKAGE_INVALID');
  recordId(source.applicationId); recordId(source.runtimeId);
  need(selected?.kind === 'grant-workspace' && selected.applicationId === source.applicationId &&
    selected.baseRevision === source.applicationRevision && selected.form.runtimeId === source.runtimeId &&
    family.workspaceId === source.workspaceId, 'GRANT_HANDOFF_APPLICATION_SOURCE_CHANGED');
  return { document: value, caseBytes, setupBytes, setup };
}
function packageBytes(bytes, filename = PACKAGE) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= GRANT_HANDOFF_MAX_BYTES,
    'GRANT_HANDOFF_PACKAGE_INVALID');
  const checked = checkedPackage(JSON.parse(decode(bytes)));
  return { ...checked, bytes, sha256: digest(bytes), filename };
}
async function readPackage(path) {
  return packageBytes(await regular(absolute(resolve(path)), GRANT_HANDOFF_MAX_BYTES), basename(path));
}
function inlinePackage(value) {
  need(typeof value === 'string', 'GRANT_HANDOFF_PACKAGE_INVALID');
  return packageBytes(Buffer.from(value, 'utf8'));
}
function packageSummary(checked) {
  const document = checked.document;
  return { schema: document.schema, id: document.id, name: document.name, createdAt: document.createdAt,
    bytes: checked.bytes.length, sha256: checked.sha256, source: document.source,
    files: Object.fromEntries(Object.entries(document.files).map(([name, value]) => {
      const { contentBase64, ...metadata } = value; return [name, metadata];
    })) };
}
export async function inspectGrantHandoff({ package: path = null, packageText = null }) {
  need(Boolean(path) !== (packageText !== null), 'GRANT_HANDOFF_PACKAGE_REQUIRED');
  const checked = packageText !== null ? inlinePackage(packageText) : await readPackage(path);
  return { ...packageSummary(checked), setup: checked.setup };
}
function runtimeIdentity(runtime) {
  return { directory: runtime.directory, installationId: runtime.installationId, profileId: runtime.profileId,
    sourceCommit: runtime.sourceCommit, sourceManifestSha256: runtime.sourceManifestSha256,
    profileSha256: runtime.profileSha256, lockSha256: runtime.lockSha256 };
}
async function selectedRuntime(model, runtimeId) {
  const state = await model.state(), selected = state.runtimes.find(item => item.id === recordId(runtimeId));
  need(selected?.phase === 'READY', 'GRANT_HANDOFF_RUNTIME_REQUIRED', 'Select an attached READY Grant Operations runtime.');
  const runtime = await inspectMerchantRuntime(absolute(selected.directory), { load: false, source: false });
  const source = await realpath(join(runtime.sourceRoot, NATIVE));
  need(source === join(runtime.sourceRoot, NATIVE), 'GRANT_HANDOFF_NATIVE_SOURCE_CHANGED');
  const original = await import(pathToFileURL(join(source, 'agent-client.mjs')).href);
  need(typeof original.inspectGrantAgentBinding === 'function' && typeof original.GrantWorkspaceClient === 'function',
    'GRANT_HANDOFF_NATIVE_CLIENT_REQUIRED', 'Use a runtime containing the original Grant Operations agent client.');
  return { state, runtime, original };
}
function nativeInput(settings, allowStart) {
  need(plain(settings), 'GRANT_HANDOFF_BINDINGS_INVALID');
  const directory = absolute(settings.workspaceDirectory), pythonExecutable = absolute(settings.pythonExecutable ?? '/usr/bin/python3');
  const result = { directory, pythonExecutable, allowStart };
  if (settings.scenarioFile) result.scenarioFile = absolute(settings.scenarioFile);
  return result;
}
async function nativeSelection(model, runtimeId, settings, allowStart) {
  const selected = await selectedRuntime(model, runtimeId);
  const input = nativeInput(settings, boolean(allowStart, 'allowStart'));
  await privateDirectory(dirname(input.directory));
  try { await privateDirectory(input.directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const binding = await selected.original.inspectGrantAgentBinding(input);
  need(binding.selection.sourceDirectory === join(selected.runtime.sourceRoot, NATIVE),
    'GRANT_HANDOFF_NATIVE_SOURCE_CHANGED');
  return { ...selected, binding };
}
function nativeIdentity(selected) {
  return { runtime: runtimeIdentity(selected.runtime), selectionSha256: selected.binding.selectionSha256,
    directory: selected.binding.directory, scenarioFile: selected.binding.scenarioFile,
    pythonExecutable: selected.binding.pythonExecutable, allowStart: selected.binding.allowStart };
}
async function openNative(selected) {
  const client = new selected.original.GrantWorkspaceClient(selected.binding);
  try {
    await client.open({ expectedSelectionSha256: selected.binding.selectionSha256 });
    return client;
  } catch (error) { await client.close().catch(() => {}); throw error; }
}
async function application(model, id) {
  const state = await model.applicationsState({ historyLimit: 1 });
  const selected = state.applications.find(item => item.id === recordId(id));
  need(selected && !selected.error && selected.kind === 'grant-workspace',
    'GRANT_HANDOFF_APPLICATION_REQUIRED', 'Select the saved Grant planning and delivery application.');
  return selected;
}
/** Read the original saved cases from the selected Grant Application. */
export async function grantHandoffCases(model, { applicationId, allowStart = false }) {
  const saved = await application(model, applicationId);
  const selected = await nativeSelection(model, saved.runtimeId, saved.settings, allowStart);
  const client = await openNative(selected);
  try {
    const result = await client.read('cases');
    need(Array.isArray(result.value?.cases), 'GRANT_HANDOFF_CASE_LIST_INVALID');
    const current = await application(model, saved.id);
    need(hash(applicationIdentity(current)) === hash(applicationIdentity(saved)),
      'GRANT_HANDOFF_APPLICATION_SOURCE_CHANGED');
    return { application: applicationIdentity(saved), selection: nativeIdentity(selected),
      cases: result.value.cases, source: result.source };
  } finally { await client.close(); }
}
function applicationIdentity(value) {
  return { id: value.id, revision: value.revision, runtimeId: value.runtimeId,
    kind: value.kind, label: value.label, settings: value.settings };
}
async function selectedWorkspace(model, record) {
  const state = await model.state();
  need(model.directory === record.workspaceDirectory && state.workspaceId === record.workspaceId,
    'GRANT_HANDOFF_WORKSPACE_CHANGED', 'Resume with the original runtime workspace.');
  return state;
}
async function readRecord(root) {
  const record = await readJSON(join(root, 'handoff', 'operation.json'));
  need(record?.schema === GRANT_HANDOFF_OPERATION_SCHEMA && ['EXPORT', 'RECEIVE'].includes(record.direction),
    'GRANT_HANDOFF_OPERATION_INVALID');
  operationId(record.id);
  need(typeof record.workspaceDirectory === 'string' && typeof record.workspaceId === 'string',
    'GRANT_HANDOFF_OPERATION_INVALID');
  return record;
}
async function writeRecord(root, record) {
  record.updatedAt = now();
  await saveJSON(join(root, 'handoff', 'operation.json'), record, true);
}
async function retainFailure(root, record, error) {
  record.lastError = { at: now(), code: error.code ?? 'GRANT_HANDOFF_ERROR', message: String(error.message ?? error) };
  await writeRecord(root, record);
}
async function stage(root, directoryName, populate) {
  const temporary = join(root, directoryName + '.pending-' + randomUUID());
  await makePrivate(temporary);
  try {
    await populate(temporary);
    await rename(temporary, join(root, directoryName));
    await syncDirectory(root);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
function report(root, record) {
  return { schema: record.schema, operationId: record.id, operationDirectory: root, direction: record.direction,
    phase: record.phase, workspaceId: record.workspaceId, package: record.package ?? null,
    selection: record.selection, originalCase: record.originalCase ?? null,
    importRequest: record.importRequest ?? null, imported: record.imported ?? null,
    preflight: record.preflight ?? null, application: record.application ?? null, lastError: record.lastError ?? null,
    createdAt: record.createdAt, updatedAt: record.updatedAt };
}
export async function grantHandoffStatus({ operation: directory }) {
  return localOperation(directory, async root => {
    const record = await readRecord(root);
    if (record.package) {
      const received = await readPackage(join(root, record.package.file));
      need(received.sha256 === record.package.sha256, 'GRANT_HANDOFF_PACKAGE_CHANGED');
    }
    const result = report(root, record);
    if (record.direction === 'RECEIVE' && record.application)
      result.application = await applicationSetupStatus({ operation: join(root, 'application') });
    return result;
  });
}
export async function exportGrantHandoff(model, {
  operation: directory, applicationId, caseId: originalCaseId, expectedVersion, name,
  allowStart = false, requestId = null,
}) {
  return localOperation(directory, async root => {
    let record = await readJSON(join(root, 'handoff', 'operation.json'), true);
    if (record) {
      record = await readRecord(root);
      need(record.direction === 'EXPORT', 'GRANT_HANDOFF_OPERATION_CHANGED');
      await selectedWorkspace(model, record);
      if (applicationId !== undefined) need(applicationId === record.selection.application.id, 'GRANT_HANDOFF_APPLICATION_SOURCE_CHANGED');
      if (originalCaseId !== undefined) need(originalCaseId === record.originalCase.id, 'GRANT_HANDOFF_CASE_CHANGED');
      if (expectedVersion !== undefined) need(expectedVersion === record.originalCase.version, 'GRANT_HANDOFF_CASE_CHANGED');
      if (name !== undefined) need(name === record.name, 'GRANT_HANDOFF_INPUT_CHANGED');
      if (requestId) need(requestId === record.id, 'GRANT_HANDOFF_REQUEST_CHANGED');
    } else {
      const saved = await application(model, applicationId);
      const selected = await nativeSelection(model, saved.runtimeId, saved.settings, allowStart);
      const stamp = now();
      record = { schema: GRANT_HANDOFF_OPERATION_SCHEMA, id: operationId(requestId ?? randomUUID()),
        direction: 'EXPORT', phase: 'PREPARED', createdAt: stamp, updatedAt: stamp,
        workspaceDirectory: model.directory, workspaceId: selected.state.workspaceId,
        name: text(name ?? saved.label, 'handoff name'),
        originalCase: { id: caseId(originalCaseId), version: version(expectedVersion) },
        selection: { application: applicationIdentity(saved), native: nativeIdentity(selected) } };
      await stage(root, 'handoff', async destination => saveJSON(join(destination, 'operation.json'), record));
    }
    try {
      if (record.phase === 'EXPORTED') {
        const checked = await readPackage(join(root, PACKAGE));
        need(checked.sha256 === record.package.sha256, 'GRANT_HANDOFF_PACKAGE_CHANGED');
        return report(root, record);
      }
      const capturePath = join(root, 'captured', 'capture.json');
      let capture = await readJSON(capturePath, true);
      if (!capture) {
        const current = await application(model, record.selection.application.id);
        need(hash(applicationIdentity(current)) === hash(record.selection.application), 'GRANT_HANDOFF_APPLICATION_SOURCE_CHANGED',
          'The saved application changed before its paired export. Keep this operation and select a new handoff for the new setup.');
        const selected = await nativeSelection(model, current.runtimeId, current.settings, record.selection.native.allowStart);
        need(hash(nativeIdentity(selected)) === hash(record.selection.native), 'GRANT_HANDOFF_NATIVE_SELECTION_CHANGED');
        const client = await openNative(selected);
        try {
          const first = await client.read('case', { caseId: record.originalCase.id });
          need(first.value?.program?.id === record.originalCase.id &&
            first.value.program.version === record.originalCase.version, 'GRANT_HANDOFF_CASE_CHANGED',
          'Read the current case version before preparing its complete handoff.');
          await stage(root, 'captured', async destination => {
            await exportApplicationSetup(model, { applicationId: current.id, output: join(destination, 'setup.json'), name: record.name });
            const exported = await client.download('case', { caseId: record.originalCase.id });
            need(Buffer.isBuffer(exported.bytes) && exported.bytes.length > 0 && exported.bytes.length <= MAX_CASE,
              'GRANT_HANDOFF_CASE_EXPORT_INVALID');
            const after = await client.read('case', { caseId: record.originalCase.id });
            const afterApplication = await application(model, current.id);
            need(after.value?.program?.version === record.originalCase.version &&
              hash(applicationIdentity(afterApplication)) === hash(record.selection.application),
            'GRANT_HANDOFF_SOURCE_CHANGED', 'The case or application changed while its paired export was being prepared.');
            const program = first.value.program;
            capture = { source: { workspaceId: record.workspaceId, applicationId: current.id,
              applicationRevision: current.revision, runtimeId: current.runtimeId,
              runtime: record.selection.native.runtime, nativeSelectionSha256: selected.binding.selectionSha256,
              nativeSource: exported.source,
              case: { id: program.id, version: program.version, mode: program.mode,
                planId: program.planId, planRevision: program.planRevision } },
              case: { file: 'case.zip', bytes: exported.bytes.length, sha256: digest(exported.bytes) } };
            const setup = await regular(join(destination, 'setup.json'), MAX_SETUP);
            capture.setup = { file: 'setup.json', bytes: setup.length, sha256: digest(setup) };
            await retainBytes(join(destination, 'case.zip'), exported.bytes);
            await saveJSON(join(destination, 'capture.json'), capture);
          });
        } finally { await client.close(); }
      }
      const caseBytes = await regular(join(root, 'captured', 'case.zip'), MAX_CASE);
      const setupBytes = await regular(join(root, 'captured', 'setup.json'), MAX_SETUP);
      need(digest(caseBytes) === capture.case.sha256 && digest(setupBytes) === capture.setup.sha256 &&
        caseBytes.length === capture.case.bytes && setupBytes.length === capture.setup.bytes,
      'GRANT_HANDOFF_CAPTURE_CHANGED');
      const document = { schema: GRANT_HANDOFF_SCHEMA, id: record.id, createdAt: record.createdAt, name: record.name,
        source: capture.source, files: { case: bytesRecord('complete-operating-case.zip', caseBytes, 'application/zip'),
          setup: bytesRecord('application-setup.json', setupBytes, 'application/json') } };
      checkedPackage(document);
      const bytes = Buffer.from(json(document));
      need(bytes.length <= GRANT_HANDOFF_MAX_BYTES, 'GRANT_HANDOFF_PACKAGE_TOO_LARGE');
      await retainBytes(join(root, PACKAGE), bytes);
      record.package = { file: PACKAGE, bytes: bytes.length, sha256: digest(bytes), name: record.name };
      record.phase = 'EXPORTED'; delete record.lastError;
      await writeRecord(root, record);
      return report(root, record);
    } catch (error) { await retainFailure(root, record, error); throw error; }
  }, true);
}
async function readNativeCase(path, encoded, filename) {
  if (path) return { bytes: await regular(absolute(resolve(path)), MAX_CASE), filename: basename(path) };
  need(typeof encoded === 'string' && encoded.length <= Math.ceil(MAX_CASE / 3) * 4,
    'GRANT_HANDOFF_NATIVE_CASE_INVALID', 'Choose the complete native case ZIP, up to 32 MiB.');
  const bytes = Buffer.from(encoded, 'base64');
  need(bytes.length > 0 && bytes.length <= MAX_CASE && bytes.toString('base64') === encoded,
    'GRANT_HANDOFF_NATIVE_CASE_INVALID');
  return { bytes, filename: text(filename, 'original native archive filename', 240) };
}
async function nativeCasePackage(model, native, bindings, selected, stamp, id, name) {
  const state = await model.applicationsState({ historyLimit: 1 });
  const declaration = state.catalog.find(item => item.id === 'grant-workspace');
  need(declaration, 'GRANT_HANDOFF_APPLICATION_REQUIRED', 'Use a workspace containing the Grant planning and delivery provider.');
  const fields = declaration.fields ?? [], values = bindings.settings;
  const names = new Set([...Object.keys(values), ...fields.map(field => field.name)]);
  const form = { label: bindings.label, runtimeId: bindings.runtimeId, kind: 'grant-workspace',
    settings: Object.fromEntries([...names].map(key => {
      const type = fields.find(field => field.name === key)?.type;
      const checked = type === 'boolean' || typeof values[key] === 'boolean';
      return [key, { value: checked ? 'on' : String(values[key] ?? (type === 'port' ? '0' : '')),
        checked: checked && values[key] === true }];
    })) };
  const contextId = 'native-grant:' + id, entryId = contextId + '/grant-workspace';
  const setup = createSetupDocument({ schema: FAMILY_SCHEMA, workspaceId: selected.state.workspaceId,
    active: entryId, entries: [{ workspaceId: selected.state.workspaceId, contextId, id: entryId,
      applicationId: null, kind: 'grant-workspace', baseRevision: null, updatedAt: stamp,
      baseline: clone(form), form, sourceCatalog: clone(declaration) }] },
  name, { catalog: state.catalog, runtimes: selected.state.runtimes });
  const document = { schema: GRANT_NATIVE_HANDOFF_SCHEMA, id, createdAt: stamp, name,
    source: { kind: 'native-archive' }, files: {
      case: bytesRecord(native.filename, native.bytes, 'application/zip'),
      setup: bytesRecord('new-application-setup.json', Buffer.from(json(setup)), 'application/json'),
    } };
  return packageBytes(Buffer.from(json(document)));
}
function receivingBindings(value) {
  exact(value, ['runtimeId', 'label', 'settings', 'caseName', 'actor', 'allowStart'],
    ['runtimeId', 'label', 'settings', 'caseName', 'actor', 'allowStart']);
  recordId(value.runtimeId); text(value.label, 'receiving application label', 120);
  text(value.caseName, 'received case name'); text(value.actor, 'recording operator');
  boolean(value.allowStart, 'allowStart'); nativeInput(value.settings, value.allowStart);
  return value;
}
async function readReceiving(root, record) {
  need(record.direction === 'RECEIVE', 'GRANT_HANDOFF_OPERATION_CHANGED');
  operationId(record.applicationRequestId);
  const received = await readPackage(join(root, record.package.file));
  need(received.sha256 === record.package.sha256 && received.bytes.length === record.package.bytes,
    'GRANT_HANDOFF_PACKAGE_CHANGED');
  const bindingBytes = await regular(join(root, 'handoff', 'host-bindings.json'), MAX_SETUP);
  need(digest(bindingBytes) === record.bindings.sha256, 'GRANT_HANDOFF_BINDINGS_CHANGED');
  const bindings = receivingBindings(JSON.parse(decode(bindingBytes)));
  need(hash(bindings) === hash(record.selection.bindings) &&
    record.importRequest.requestId === 'grant-handoff-import-' + record.id &&
    record.importRequest.name === bindings.caseName && record.importRequest.actor === bindings.actor,
  'GRANT_HANDOFF_REQUEST_CHANGED');
  const storedSetup = await regular(join(root, 'handoff', 'application-setup.json'), MAX_SETUP);
  const storedCase = await regular(join(root, 'handoff', 'case.zip'), MAX_CASE);
  const applicationBindings = await readJSON(join(root, 'handoff', 'application-bindings.json'));
  need(storedSetup.equals(received.setupBytes) && storedCase.equals(received.caseBytes) &&
    hash(applicationBindings) === hash({ runtimeId: bindings.runtimeId, label: bindings.label, settings: bindings.settings }),
  'GRANT_HANDOFF_RECEIVING_FILES_CHANGED');
  if (record.imported) {
    const original = await regular(join(root, 'handoff', 'import-result.json'), 4 * 1024 * 1024);
    need(digest(original) === record.imported.sha256 && original.length === record.imported.bytes &&
      hash(JSON.parse(decode(original))) === hash(record.imported.result), 'GRANT_HANDOFF_IMPORT_RESULT_CHANGED');
  }
  return { received, bindings };
}
function applicationReviewRequest(bindings) {
  return { runtimeId: bindings.runtimeId, kind: 'grant-workspace', label: bindings.label, settings: bindings.settings };
}
function checkApplicationSelection(application, record, received, bindings) {
  const request = application.reviewRequest;
  need(application.mode === 'new' && application.variant?.kind === 'grant-workspace' &&
    application.source?.sha256 === received.document.files.setup.sha256 &&
    application.saveRequest?.requestId === record.applicationRequestId &&
    request?.applicationId === null && request.expectedRevision === null &&
    request.runtimeId === bindings.runtimeId && request.kind === 'grant-workspace' &&
    request.label === bindings.label && hash(request.settings) === hash(bindings.settings),
  'GRANT_HANDOFF_APPLICATION_SELECTION_CHANGED');
}
export async function prepareGrantHandoff(model, {
  operation: directory, package: packagePath = null, bindings: bindingsPath = null, requestId = null,
  packageText = null, bindingsValue = null, caseArchive = null, caseBase64 = null, caseFilename = null, name = null,
}) {
  const incomingCount = [Boolean(packagePath), packageText !== null, Boolean(caseArchive), caseBase64 !== null].filter(Boolean).length;
  const nativeInputSelected = Boolean(caseArchive) || caseBase64 !== null;
  need(incomingCount <= 1 && !(bindingsPath && bindingsValue !== null) &&
    (caseFilename === null || caseBase64 !== null) && (name === null || nativeInputSelected),
  'GRANT_HANDOFF_INPUT_INVALID', 'Choose one complete handoff or native case ZIP and one complete destination binding.');
  const readIncoming = () => packageText !== null ? inlinePackage(packageText) : readPackage(packagePath);
  const readBindings = async () => bindingsValue !== null ? Buffer.from(json(receivingBindings(bindingsValue))) :
    regular(absolute(resolve(bindingsPath)), MAX_SETUP);
  return localOperation(directory, async root => {
    let record = await readJSON(join(root, 'handoff', 'operation.json'), true);
    if (record) {
      record = await readRecord(root); await selectedWorkspace(model, record);
      await readReceiving(root, record);
      if (packagePath || packageText !== null) need((await readIncoming()).sha256 === record.package.sha256, 'GRANT_HANDOFF_PACKAGE_CHANGED');
      if (nativeInputSelected) {
        const native = await readNativeCase(caseArchive, caseBase64, caseFilename);
        const original = await readPackage(join(root, record.package.file));
        need(original.document.schema === GRANT_NATIVE_HANDOFF_SCHEMA && original.caseBytes.equals(native.bytes),
          'GRANT_HANDOFF_NATIVE_CASE_CHANGED');
        if (name !== null) need(name === original.document.name, 'GRANT_HANDOFF_INPUT_CHANGED');
      }
      if (bindingsPath || bindingsValue !== null) need(digest(await readBindings()) === record.bindings.sha256,
        'GRANT_HANDOFF_BINDINGS_CHANGED');
      if (requestId) need(requestId === record.id, 'GRANT_HANDOFF_REQUEST_CHANGED');
      if (!record.preflight) {
        try {
          record.preflight = await model.applicationsReview(applicationReviewRequest(record.selection.bindings));
          delete record.lastError; await writeRecord(root, record);
        } catch (error) { await retainFailure(root, record, error); throw error; }
      }
      return report(root, record);
    }
    need(incomingCount === 1 && (bindingsPath || bindingsValue !== null),
      'GRANT_HANDOFF_RECEIVING_REQUIRED', 'Choose the complete handoff or native case ZIP and explicit receiving host bindings.');
    const bindingBytes = await readBindings();
    need(bindingBytes.length <= MAX_SETUP, 'GRANT_HANDOFF_BINDINGS_INVALID');
    const bindings = receivingBindings(JSON.parse(decode(bindingBytes)));
    const selected = await nativeSelection(model, bindings.runtimeId, bindings.settings, bindings.allowStart);
    const stamp = now(), id = operationId(requestId ?? randomUUID());
    const received = nativeInputSelected ? await nativeCasePackage(model,
      await readNativeCase(caseArchive, caseBase64, caseFilename), bindings, selected, stamp, id,
      text(name ?? bindings.caseName, 'handoff name')) : await readIncoming();
    record = { schema: GRANT_HANDOFF_OPERATION_SCHEMA, id, direction: 'RECEIVE', phase: 'PREPARED',
      createdAt: stamp, updatedAt: stamp, workspaceDirectory: model.directory, workspaceId: selected.state.workspaceId,
      package: { file: 'handoff/' + PACKAGE, filename: received.filename, bytes: received.bytes.length,
        sha256: received.sha256, name: received.document.name },
      originalCase: received.document.source.case ?? null,
      bindings: { file: 'host-bindings.json', bytes: bindingBytes.length, sha256: digest(bindingBytes) },
      selection: { bindings: clone(bindings), native: nativeIdentity(selected) },
      importRequest: { requestId: 'grant-handoff-import-' + id, name: bindings.caseName, actor: bindings.actor },
      applicationRequestId: randomUUID() };
    await stage(root, 'handoff', async destination => {
      await retainBytes(join(destination, PACKAGE), received.bytes);
      await retainBytes(join(destination, 'host-bindings.json'), bindingBytes);
      await retainBytes(join(destination, 'case.zip'), received.caseBytes);
      await retainBytes(join(destination, 'application-setup.json'), received.setupBytes);
      await saveJSON(join(destination, 'application-bindings.json'),
        { runtimeId: bindings.runtimeId, label: bindings.label, settings: bindings.settings });
      await saveJSON(join(destination, 'operation.json'), record);
    });
    try {
      record.preflight = await model.applicationsReview(applicationReviewRequest(bindings));
      await writeRecord(root, record);
      return report(root, record);
    } catch (error) { await retainFailure(root, record, error); throw error; }
  }, true);
}
async function retainedNative(model, record, bindings) {
  const selected = await nativeSelection(model, bindings.runtimeId, bindings.settings, bindings.allowStart);
  need(hash(nativeIdentity(selected)) === hash(record.selection.native), 'GRANT_HANDOFF_NATIVE_SELECTION_CHANGED',
    'Resume with this handoff operation and its originally selected installed runtime and grant workspace.');
  return selected;
}
function checkReceivedCase(result, record, received) {
  const program = result?.program;
  if (received.document.schema === GRANT_NATIVE_HANDOFF_SCHEMA) {
    const imported = record.imported.result;
    need(program?.id === imported.id && program.origin?.archiveSha256 === received.document.files.case.sha256 &&
      program.planId === imported.planId && program.mode === imported.mode && program.version >= imported.version,
    'GRANT_HANDOFF_RECEIVED_CASE_CHANGED', 'Reopen the original native case import before continuing its Application.');
    const original = { id: caseId(program.origin.programId), version: version(imported.version),
      mode: imported.mode, planId: program.origin.planId };
    need(['OPERATIONS', 'WALKTHROUGH'].includes(original.mode) &&
      /^plan-[a-f0-9]{32}$/.test(original.planId ?? ''), 'GRANT_HANDOFF_RECEIVED_CASE_CHANGED');
    if (record.originalCase) need(hash(record.originalCase) === hash(original), 'GRANT_HANDOFF_RECEIVED_CASE_CHANGED');
    else record.originalCase = original;
    return;
  }
  need(program?.origin?.archiveSha256 === received.document.files.case.sha256 &&
    program.origin.programId === record.originalCase.id && program.origin.planId === record.originalCase.planId &&
    program.mode === record.originalCase.mode && program.planRevision === record.originalCase.planRevision &&
    program.version >= record.originalCase.version, 'GRANT_HANDOFF_RECEIVED_CASE_CHANGED',
  'Read the original imported case and its retained source before continuing its application.');
}
export async function receiveGrantHandoff(model, { operation: directory }) {
  return localOperation(directory, async root => {
    const record = await readRecord(root); await selectedWorkspace(model, record);
    const { received, bindings } = await readReceiving(root, record);
    try {
      if (['APPLICATION_REVIEWED', 'APPLICATION_SAVED'].includes(record.phase)) {
        record.application = await applicationSetupStatus({ operation: join(root, 'application') });
        checkApplicationSelection(record.application, record, received, bindings);
        if (record.application.phase === 'SAVED') record.phase = 'APPLICATION_SAVED';
        await writeRecord(root, record);
        return report(root, record);
      }
      need(['PREPARED', 'CASE_RECEIVED'].includes(record.phase), 'GRANT_HANDOFF_OPERATION_INVALID');
      const selected = await retainedNative(model, record, bindings);
      if (record.phase === 'PREPARED') {
        record.preflight = await model.applicationsReview(applicationReviewRequest(bindings));
        await writeRecord(root, record);
      }
      const client = await openNative(selected);
      try {
        if (record.phase === 'PREPARED') {
          const result = await client.importBundle('case', received.caseBytes, record.importRequest);
          caseId(result.value?.id);
          need(result.value.action === 'import', 'GRANT_HANDOFF_IMPORT_RESULT_INVALID');
          await retainBytes(join(root, 'handoff', 'import-result.json'), result.bytes);
          record.imported = { result: result.value, file: 'handoff/import-result.json', bytes: result.bytes.length,
            sha256: digest(result.bytes), source: result.source };
          record.phase = 'CASE_RECEIVED'; delete record.lastError;
          await writeRecord(root, record);
        }
        const current = await client.read('case', { caseId: record.imported.result.id });
        checkReceivedCase(current.value, record, received);
      } finally { await client.close(); }
      // The native importer has completed and its owned service is closed before
      // the original Applications review binds this receiving workspace.
      record.application = await prepareApplicationSetup(model, { operation: join(root, 'application'),
        document: join(root, 'handoff', 'application-setup.json'), mode: 'new', kind: 'grant-workspace',
        bindings: join(root, 'handoff', 'application-bindings.json'), requestId: record.applicationRequestId });
      checkApplicationSelection(record.application, record, received, bindings);
      record.phase = record.application.phase === 'SAVED' ? 'APPLICATION_SAVED' : 'APPLICATION_REVIEWED';
      delete record.lastError; await writeRecord(root, record);
      return report(root, record);
    } catch (error) { await retainFailure(root, record, error); throw error; }
  });
}
export async function saveGrantHandoffApplication(model, { operation: directory }) {
  return localOperation(directory, async root => {
    const record = await readRecord(root); await selectedWorkspace(model, record);
    const { received, bindings } = await readReceiving(root, record);
    need(['APPLICATION_REVIEWED', 'APPLICATION_SAVED'].includes(record.phase), 'GRANT_HANDOFF_APPLICATION_REVIEW_REQUIRED',
      'Receive the original case and inspect its returned Applications review before saving this handoff.');
    try {
      const current = await applicationSetupStatus({ operation: join(root, 'application') });
      checkApplicationSelection(current, record, received, bindings);
      record.application = await saveApplicationSetup(model, { operation: join(root, 'application') });
      record.phase = 'APPLICATION_SAVED'; delete record.lastError;
      await writeRecord(root, record);
      return report(root, record);
    } catch (error) { await retainFailure(root, record, error); throw error; }
  });
}

/** Download the same complete original export through an authenticated browser. */
export async function grantHandoffDownload({ operation: directory }) {
  return localOperation(directory, async root => {
    const record = await readRecord(root);
    need(record.direction === 'EXPORT' && record.phase === 'EXPORTED', 'GRANT_HANDOFF_EXPORT_REQUIRED');
    const checked = await readPackage(join(root, PACKAGE));
    need(checked.sha256 === record.package.sha256, 'GRANT_HANDOFF_PACKAGE_CHANGED');
    return { filename: PACKAGE, bytes: checked.bytes.length, sha256: checked.sha256, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(checked.bytes) };
  });
}
