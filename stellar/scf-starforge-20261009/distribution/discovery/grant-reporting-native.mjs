// MIT. Capture the original managed case into the existing reporting preparation.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { prepareGrantReportingPlan } from './grant-reporting-core.mjs';
import { GRANT_REPORTING_PREPARATION_SCHEMA } from './grant-reporting-input.mjs';
import { renderOperatingPlanHTML, renderOperatingPlanMarkdown } from './operating-plan.mjs';
import { saveTextExport } from './write-json.mjs';

export const GRANT_REPORTING_CAPTURE_SCHEMA = 'stellar-forge.grant-reporting-capture.v1';
const MAX_FILE = 32 * 1024 * 1024, MAX_PREPARATION = 96 * 1024 * 1024;
const FIELD_NAMES = ['id','savedAt','title','customer','period','owner','receiving','startDate','asOfDate',
  'receivingWorkspace','commandFinderUrl'];
const SELECTION_NAMES = ['actor','note','selectedRevision','parentSourceId','sourceIds','tables','editions','stepLinks'];
const FILE_LIMITS = {
  'reporting-preparation.json': MAX_PREPARATION, 'grant-reporting-plan.json': MAX_FILE,
  'grant-reporting-plan.html': MAX_PREPARATION, 'grant-reporting-plan.md': MAX_PREPARATION,
  'grant-procedure.json': 8 * 1024 * 1024,
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const same = (left, right) => canonical(left) === canonical(right);
export class GrantReportingCaptureError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'GrantReportingCaptureError'; this.code = code; this.details = details;
  }
}
function need(value, code, message, details) {
  if (!value) throw new GrantReportingCaptureError(code, message, details);
}
function exact(value, allowed, label) {
  need(plain(value), 'REPORTING_CAPTURE_INPUT', label + ' must be an object.');
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  need(!extra.length, 'REPORTING_CAPTURE_INPUT', 'Unknown ' + label + ' field: ' + extra.join(', '));
}
function path(value, label) {
  need(typeof value === 'string' && value.length <= 4096 && !/[\r\n\u0000]/.test(value) &&
    isAbsolute(value), 'REPORTING_CAPTURE_PATH', label + ' must be an absolute path on the operating host.');
  return resolve(value);
}
const exists = async filename => {
  try { await lstat(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
function parse(raw, label) {
  try {
    const text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(raw);
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    need(plain(value), 'REPORTING_CAPTURE_JSON', label + ' must contain a complete JSON object.');
    return {text, value};
  } catch (error) {
    if (error instanceof GrantReportingCaptureError) throw error;
    throw new GrantReportingCaptureError('REPORTING_CAPTURE_JSON', label + ' must contain complete UTF-8 JSON.');
  }
}
function originalFile(raw, kind, name) {
  need(Buffer.isBuffer(raw) && raw.length <= MAX_FILE, 'REPORTING_CAPTURE_SIZE',
    'The complete ' + kind + ' input must fit the original 32 MiB file bound.');
  const received = parse(raw, name);
  need(Buffer.from(received.text, 'utf8').equals(raw), 'REPORTING_CAPTURE_ENCODING',
    'Retain the complete original UTF-8 bytes for ' + name + '.');
  return {name, kind, bytes:raw.length, sha256:digest(raw), text:received.text};
}
async function clientModule() {
  try { return await import('../../../scf_2026/sf47_budget_model/workspace/agent-client.mjs'); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw new GrantReportingCaptureError(
      'REPORTING_CAPTURE_INSTALLATION',
      'Native capture requires the complete Grant Operations source selection. Open this command from the installed Grant Operations toolkit.',
      {originalMessage:error.message});
    throw error;
  }
}
async function procedureModule() {
  try { return await import('../../../scf_2026/sf47_budget_model/workspace/grant_procedures_native.mjs'); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw new GrantReportingCaptureError(
      'REPORTING_CAPTURE_INSTALLATION',
      'Procedure preparation requires the complete Grant Operations procedure receiver in this source selection.',
      {originalMessage:error.message});
    throw error;
  }
}
function checkedCase(response, caseId) {
  need(Buffer.isBuffer(response?.bytes) && response.sha256 === digest(response.bytes),
    'REPORTING_CAPTURE_RESPONSE', 'Retain the complete original native case response.');
  const decoded = parse(response.bytes, 'The native case response');
  need(same(decoded.value, response.value), 'REPORTING_CAPTURE_RESPONSE',
    'The original native response bytes and selected case value differ.');
  need(response.value?.program?.id === caseId, 'REPORTING_CAPTURE_CASE',
    'The native case response belongs to another case.');
  return response.value;
}
async function nativeSelection(input, sourceProjectFile, sourceBytes, readOriginal) {
  exact(input, SELECTION_NAMES, 'procedure selection');
  const selected = copy(input);
  if (selected.tables !== undefined) {
    need(Array.isArray(selected.tables), 'REPORTING_CAPTURE_SELECTION', 'Procedure tables must be an array.');
    selected.tables = await Promise.all(selected.tables.map(async table => {
      need(plain(table), 'REPORTING_CAPTURE_SELECTION', 'Select an original table object.');
      if (table.origin !== 'local-original') return table;
      exact(table, ['key','origin','file'], 'local table selection');
      const filename = path(table.file, 'The selected original table');
      const raw = filename === sourceProjectFile ? sourceBytes : await readOriginal(filename, MAX_FILE);
      return {key:table.key, origin:'local-original', originalText:parse(raw, filename).text};
    }));
  }
  return selected;
}

/**
 * Read one existing native case and retain a complete portable preparation.
 * The original client owns its ordinary service lifecycle; all case operations here are reads.
 */
export async function captureGrantReportingPlan({
  binding, caseId, expectedVersion, sourceProjectFile, directory, catalog, catalogFile,
  fields, procedureSelection, sourceRoot, sourceSelection,
} = {}) {
  exact(fields, FIELD_NAMES, 'report fields');
  need(/^operation-[a-f0-9]{32}$/.test(caseId || ''), 'REPORTING_CAPTURE_CASE',
    'Select the original operation- case identifier.');
  need(expectedVersion === undefined || Number.isSafeInteger(expectedVersion) && expectedVersion > 0,
    'REPORTING_CAPTURE_VERSION', 'The reviewed case version must be a positive safe integer.');
  need((catalog !== undefined) !== (catalogFile !== undefined), 'REPORTING_CAPTURE_CATALOG',
    'Select the complete toolkit catalog object or one complete catalog file.');
  sourceProjectFile = path(sourceProjectFile, 'The original source-project file');
  directory = path(directory, 'The new capture directory');
  const parent = await realpath(dirname(directory));
  need((await lstat(parent)).isDirectory(), 'REPORTING_CAPTURE_PATH', 'Use an existing output parent directory.');
  need(!await exists(directory), 'REPORTING_CAPTURE_EXISTS',
    'This capture directory already exists. Use capture-show to reopen it, or select a new directory for a new reporting capture.',
    {directory});
  if (sourceRoot !== undefined && sourceRoot !== null) sourceRoot = path(sourceRoot, 'The selected source checkout');
  need(sourceSelection === undefined || sourceSelection === null ||
    typeof sourceSelection === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sourceSelection),
  'REPORTING_CAPTURE_SELECTION', 'Keep the original source recipe identifier.');
  const native = await clientModule();
  const selectedBinding = await native.inspectGrantAgentBinding(binding);
  const sourceBytes = await native.readGrantAgentFile(sourceProjectFile, MAX_FILE);
  let catalogBytes, catalogOrigin;
  if (catalogFile !== undefined) {
    catalogFile = path(catalogFile, 'The original toolkit catalog');
    catalogBytes = await native.readGrantAgentFile(catalogFile, MAX_FILE);
    catalogOrigin = {kind:'file', path:catalogFile};
  } else {
    need(plain(catalog), 'REPORTING_CAPTURE_CATALOG', 'Retain the complete selected toolkit catalog.');
    catalogBytes = Buffer.from(json(catalog), 'utf8');
    catalogOrigin = {kind:'selected-toolkit'};
  }
  if (sourceRoot != null) catalogOrigin.sourceRoot = sourceRoot;
  if (sourceSelection != null) catalogOrigin.sourceSelection = sourceSelection;
  const retainedProject = originalFile(sourceBytes, 'sourceProject', basename(sourceProjectFile));
  const retainedCatalog = originalFile(catalogBytes, 'catalog', catalogFile ? basename(catalogFile) : 'toolkit-catalog.json');
  const savedAt = fields.savedAt === undefined ? new Date().toISOString() : fields.savedAt;
  const values = {
    title:fields.title, customer:fields.customer ?? '', period:fields.period ?? '',
    owner:fields.owner ?? '', receiving:fields.receiving ?? '', startDate:fields.startDate ?? '',
    asOfDate:fields.asOfDate,
    ...(sourceRoot != null ? {sourceRoot} : {}),
    ...(sourceSelection != null ? {sourceSelection} : {}),
    paths:{workspace:selectedBinding.directory, sourceProject:sourceProjectFile, outputDirectory:directory,
      receivingWorkspace:fields.receivingWorkspace, commandFinderUrl:fields.commandFinderUrl},
  };
  const client = new native.GrantWorkspaceClient(selectedBinding);
  let opened, closed, prepared, preparation, procedure = null, before, after, failure;
  try {
    await client.open({expectedSelectionSha256:selectedBinding.selectionSha256});
    opened = copy(client.summary);
    before = await client.read('case', {caseId});
    const current = checkedCase(before, caseId);
    need(expectedVersion === undefined || current.program.version === expectedVersion,
      'REPORTING_CAPTURE_CASE_CHANGED', 'The case differs from the reviewed version. Review its current state before capturing.',
      {expectedVersion, actualVersion:current.program.version});
    preparation = {
      schema:GRANT_REPORTING_PREPARATION_SCHEMA, id:'preparation-' + randomUUID().replaceAll('-', ''),
      planId:fields.id, planCreatedAt:savedAt, createdAt:savedAt, updatedAt:savedAt,
      values, files:{
        case:originalFile(before.bytes, 'case', caseId + '.json'),
        sourceProject:retainedProject, catalog:retainedCatalog,
      }, plan:null,
    };
    prepared = await prepareGrantReportingPlan(preparation);
    preparation.plan = prepared.plan;
    need(Buffer.byteLength(json(preparation)) <= MAX_PREPARATION, 'REPORTING_CAPTURE_SIZE',
      'The complete portable preparation exceeds 96 MiB.');
    if (procedureSelection !== undefined) {
      const receiver = await procedureModule();
      const selected = await nativeSelection(procedureSelection, sourceProjectFile, sourceBytes, native.readGrantAgentFile);
      procedure = await receiver.prepareGrantProcedureNative(client, {
        ...selected, caseId, operatingPlanText:json(prepared.plan),
      });
      need(procedure.document.case.id === caseId &&
        procedure.document.case.version === current.program.version,
      'REPORTING_CAPTURE_CASE_CHANGED', 'The case changed before its original procedure selection was prepared.');
    }
    after = await client.read('case', {caseId});
    const currentAfter = checkedCase(after, caseId);
    need(same(current, currentAfter), 'REPORTING_CAPTURE_CASE_CHANGED',
      'The native case or its selected planning snapshot changed during capture. Prepare again against the reviewed current selection.');
    const currentBook = await native.readGrantAgentFile(sourceProjectFile, MAX_FILE);
    need(currentBook.equals(sourceBytes), 'REPORTING_CAPTURE_SOURCE_CHANGED',
      'The original Source Tables file changed during capture. Retain the reviewed file and capture it again.');
    if (catalogFile) {
      const currentCatalog = await native.readGrantAgentFile(catalogFile, MAX_FILE);
      need(currentCatalog.equals(catalogBytes), 'REPORTING_CAPTURE_CATALOG_CHANGED',
        'The selected toolkit catalog file changed during capture.');
    }
  } catch (error) { failure = error; }
  try { closed = await client.close(); }
  catch (error) {
    if (failure) failure.closeFailure = {code:error.code ?? null, message:error.message};
    else failure = error;
  }
  if (failure) throw failure;
  const outputs = [
    ['reporting-preparation.json', json(preparation)],
    ['grant-reporting-plan.json', json(prepared.plan)],
    ['grant-reporting-plan.html', renderOperatingPlanHTML(prepared.plan)],
    ['grant-reporting-plan.md', renderOperatingPlanMarkdown(prepared.plan)],
    ...(procedure ? [['grant-procedure.json', procedure.raw]] : []),
  ];
  const files = outputs.map(([name, text]) => {
    const bytes = Buffer.byteLength(text, 'utf8');
    need(bytes <= FILE_LIMITS[name], 'REPORTING_CAPTURE_SIZE', 'The complete ' + name + ' exceeds its original size bound.');
    return {name, bytes, sha256:digest(Buffer.from(text, 'utf8'))};
  });
  const receipt = {
    schema:GRANT_REPORTING_CAPTURE_SCHEMA, capturedAt:new Date().toISOString(), directory,
    preparationId:preparation.id, planId:prepared.plan.id, planCreatedAt:prepared.plan.createdAt,
    selection:prepared.selection, files, catalogOrigin,
    native:{selectionSha256:selectedBinding.selectionSha256, source:before.source,
      before:{bytes:before.bytes.length, sha256:before.sha256},
      after:{bytes:after.bytes.length, sha256:after.sha256}, opened, closed},
    procedure:procedure ? {editionId:procedure.document.editionId, caseId:procedure.document.case.id,
      caseVersion:procedure.document.case.version, selectedRevision:procedure.document.selectedRevision,
      verification:procedure.verification} : null,
  };
  need(Buffer.byteLength(json(receipt)) <= MAX_FILE, 'REPORTING_CAPTURE_SIZE',
    'The complete capture manifest exceeds the original 32 MiB file bound.');
  await mkdir(directory, {mode:0o700});
  try {
    for (const [name, text] of outputs) await saveTextExport(join(directory, name), text);
    // The manifest is published last; every declared complete member is already durable.
    await saveTextExport(join(directory, 'capture.json'), json(receipt));
  } catch (error) {
    throw new GrantReportingCaptureError('REPORTING_CAPTURE_WRITE',
      'Capture publication was interrupted in ' + directory +
      '. Use capture-show to inspect any complete result; retain the portable preparation already written there.',
      {directory, originalCode:error.code ?? null, originalMessage:error.message});
  }
  return {directory, receipt, preparation, plan:prepared.plan,
    ...(procedure ? {procedure:procedure.document} : {})};
}

/** Reopen and validate the complete frozen capture without opening a native workspace. */
export async function readGrantReportingCapture(directory) {
  directory = path(directory, 'The existing capture directory');
  const native = await clientModule();
  const receipt = parse(await native.readGrantAgentFile(join(directory, 'capture.json'), MAX_FILE),
    'The original capture manifest').value;
  need(receipt.schema === GRANT_REPORTING_CAPTURE_SCHEMA && Array.isArray(receipt.files) &&
    (receipt.procedure === null || plain(receipt.procedure)) && plain(receipt.catalogOrigin) &&
    ['file','selected-toolkit'].includes(receipt.catalogOrigin.kind) && plain(receipt.native) &&
    plain(receipt.native.before) && plain(receipt.native.closed) &&
    ['BORROWED_CONNECTION_RELEASED','OWNED_ORIGINAL_SERVICE_CLOSED'].includes(receipt.native.closed.state),
    'REPORTING_CAPTURE_MANIFEST', 'Open a complete native reporting capture.');
  const expected = new Set(['reporting-preparation.json','grant-reporting-plan.json',
    'grant-reporting-plan.html','grant-reporting-plan.md',
    ...(receipt.procedure === null ? [] : ['grant-procedure.json'])]);
  need(receipt.files.length === expected.size, 'REPORTING_CAPTURE_MANIFEST',
    'Keep every original complete capture member.');
  const content = {};
  for (const file of receipt.files) {
    need(plain(file) && expected.delete(file.name) && Number.isSafeInteger(file.bytes) &&
      file.bytes >= 0 && file.bytes <= FILE_LIMITS[file.name] && /^[a-f0-9]{64}$/.test(file.sha256 || ''),
    'REPORTING_CAPTURE_MANIFEST', 'The original capture file selection is invalid.');
    const raw = await native.readGrantAgentFile(join(directory, file.name), FILE_LIMITS[file.name]);
    need(raw.length === file.bytes && digest(raw) === file.sha256, 'REPORTING_CAPTURE_FILE_CHANGED',
      'The complete retained file differs: ' + file.name);
    content[file.name] = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(raw);
  }
  need(expected.size === 0, 'REPORTING_CAPTURE_MANIFEST', 'A complete retained capture member is missing.');
  const preparation = parse(Buffer.from(content['reporting-preparation.json']), 'The portable preparation').value;
  const prepared = await prepareGrantReportingPlan(preparation);
  need(receipt.native.before.bytes === preparation.files.case.bytes &&
    receipt.native.before.sha256 === preparation.files.case.sha256,
  'REPORTING_CAPTURE_SOURCE_CHANGED', 'The captured native response metadata differs from its complete retained case file.');
  const plan = parse(Buffer.from(content['grant-reporting-plan.json']), 'The captured Operating plan').value;
  need((receipt.catalogOrigin?.sourceRoot ?? null) === (preparation.values.sourceRoot ?? null) &&
    (receipt.catalogOrigin?.sourceSelection ?? null) === (preparation.values.sourceSelection ?? null),
  'REPORTING_CAPTURE_CONTEXT_CHANGED', 'The original checkout and recipe no longer match the retained preparation.');
  need(same(plan, prepared.plan) && same(prepared.selection, receipt.selection) &&
    preparation.id === receipt.preparationId && plan.id === receipt.planId &&
    plan.createdAt === receipt.planCreatedAt,
  'REPORTING_CAPTURE_SELECTION_CHANGED', 'The original plan, preparation and native selection no longer agree.');
  need(content['grant-reporting-plan.html'] === renderOperatingPlanHTML(plan) &&
    content['grant-reporting-plan.md'] === renderOperatingPlanMarkdown(plan),
  'REPORTING_CAPTURE_HANDOVER_CHANGED', 'The readable handovers differ from their complete original Operating plan.');
  let procedure;
  if (receipt.procedure !== null) {
    const model = await import('../../../scf_2026/sf47_budget_model/workspace/grant_procedures.mjs');
    const inspected = await model.inspectGrantProcedure(content['grant-procedure.json']);
    procedure = inspected.document;
    need(same(inspected.plan, plan) && procedure.case.id === prepared.selection.case.id &&
      procedure.case.version === prepared.selection.case.version &&
      procedure.editionId === receipt.procedure.editionId &&
      procedure.selectedRevision === receipt.procedure.selectedRevision,
    'REPORTING_CAPTURE_PROCEDURE_CHANGED', 'The frozen native procedure differs from the original captured case and plan.');
  }
  return {directory, receipt, preparation, plan, ...(procedure ? {procedure} : {})};
}
