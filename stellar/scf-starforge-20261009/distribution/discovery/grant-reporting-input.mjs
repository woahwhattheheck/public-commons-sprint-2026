// MIT. Complete native inputs for the original Grant reporting procedure.
import { CATALOG_SCHEMA } from './catalog.mjs';
import { inspectOperatingPlan } from './operating-plan.mjs';
import { importPlanningBook } from '../../../scf_2026/sf47_budget_model/workspace/source-tables-core.mjs';
import { sha256, selectedEdition, selectedReview, reviewIsCurrent }
  from '../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs';

export const GRANT_REPORTING_PREPARATION_SCHEMA = 'stellar-forge.grant-reporting-preparation.v1';
const MAX_FILE = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const hash = /^[a-f0-9]{64}$/;
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const same = (left, right) => canonical(left) === canonical(right);

export class GrantReportingInputError extends TypeError {
  constructor(code, message, details = {}) {
    super(message); this.name = 'GrantReportingInputError'; this.code = code; this.details = details;
  }
}
function need(condition, code, message, details) {
  if (!condition) throw new GrantReportingInputError(code, message, details);
}
function text(value, label, maximum = 32000, required = false) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\u0000'),
    'REPORTING_TEXT', label + ' must be text of at most ' + maximum + ' characters without NUL.');
  need(!required || value.trim().length > 0, 'REPORTING_REQUIRED', 'Enter ' + label + '.');
  return value;
}
function date(value, label, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value,
  'REPORTING_DATE', label + ' must be a real YYYY-MM-DD calendar date.');
  return value;
}
function time(value, label) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19),
  'REPORTING_TIME', label + ' must be a UTC ISO date and time.');
  return value;
}
function identity(value, label) {
  need(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value),
    'REPORTING_ID', label + ' must contain 1–128 letters, numbers, dots, underscores or hyphens.');
  return value;
}
function parse(value, label) {
  if (typeof value !== 'string') return value === undefined || value === null ? value : copy(value);
  try { return JSON.parse(value.replace(/^\uFEFF/, '')); }
  catch { throw new GrantReportingInputError('REPORTING_JSON', label + ' must contain complete UTF-8 JSON.'); }
}
function absolutePath(value, label) {
  text(value, label, 4096, true);
  need(!/[\r\n]/.test(value) && (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)),
    'REPORTING_PATH', label + ' must be an absolute path on the operating host.');
  return value;
}
function finderURL(value) {
  text(value, 'the original Command finder address', 4096, true);
  const origin = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})(?=\/|$)/.exec(value);
  let url;
  try { url = new URL(value); } catch {}
  need(origin && Number(origin[2]) <= 65535 && url && url.protocol === 'http:' &&
    !url.username && !url.password && !url.search && !url.hash && !/[\r\n\\]/.test(value),
  'REPORTING_BROWSER', 'Keep the original loopback HTTP Command finder address and its explicit port, for example http://127.0.0.1:8846.');
  // URL.origin removes an explicit :80. Keep the user's exact loopback authority.
  return { url: value, origin: origin[0] };
}
async function portableFile(file, kind) {
  need(object(file) && file.kind === kind && typeof file.text === 'string' &&
    Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MAX_FILE &&
    hash.test(file.sha256 || ''), 'REPORTING_PREPARATION_FILE',
  'Retain the complete ' + kind + ' file and its original byte count and SHA-256.');
  text(file.name, 'the ' + kind + ' filename', 1000, true);
  const bytes = encoder.encode(file.text);
  need(bytes.length === file.bytes && await sha256(bytes) === file.sha256,
    'REPORTING_PREPARATION_FILE_CHANGED', 'The retained ' + kind + ' text differs from its saved bytes.',
    { kind });
  const value = parse(file.text, file.name);
  need(object(value), 'REPORTING_PREPARATION_FILE', file.name + ' must contain a complete JSON object.');
  return { value, identity: { name: file.name, kind, bytes: file.bytes, sha256: file.sha256 } };
}

/** Unwraps the browser's complete portable preparation without changing its plan identity. */
export async function grantReportingPreparationInput(value) {
  need(object(value), 'REPORTING_INPUT', 'Open the complete reporting preparation or builder input.');
  if (value.schema !== GRANT_REPORTING_PREPARATION_SCHEMA)
    return { input: copy(value), preview: null, retainedFiles: null };
  need(object(value.values) && object(value.files), 'REPORTING_PREPARATION',
    'Retain all entered values and original files in the complete preparation JSON.');
  const received = {};
  for (const kind of ['case', 'sourceProject', 'catalog'])
    received[kind] = await portableFile(value.files[kind], kind);
  const preview = value.plan === undefined || value.plan === null ? null : inspectOperatingPlan(value.plan);
  const id = identity(value.planId, 'The retained operating plan ID');
  const savedAt = time(value.planCreatedAt ?? preview?.createdAt ?? value.createdAt,
    'The retained operating plan creation time');
  need(!preview || preview.id === id && preview.createdAt === savedAt,
    'REPORTING_PREPARATION_PLAN', 'The retained preview must keep the preparation’s original plan identity and creation time.');
  return { input: { ...copy(value.values), id, savedAt,
    case: received.case.value, sourceProject: received.sourceProject.value, catalog: received.catalog.value },
  preview, retainedFiles: Object.fromEntries(Object.entries(received).map(([kind, file]) => [kind, file.identity])) };
}

function originalCase(value) {
  const outer = parse(value, 'The Grant case');
  const current = object(outer?.program) ? outer : object(outer?.value?.program) ? outer.value : null;
  need(current && object(current.plan) && object(current.records) &&
    (Array.isArray(current.sources) || object(current.sources)),
  'REPORTING_CASE', 'Open the complete original Operations case JSON or its native show response, including program, plan, records and sources.');
  const program = current.program, plan = current.plan;
  need(/^operation-[a-f0-9]{32}$/.test(program.id || '') &&
    /^plan-[a-f0-9]{32}$/.test(program.planId || '') &&
    Number.isSafeInteger(program.version) && program.version > 0 &&
    Number.isSafeInteger(program.planRevision) && program.planRevision > 0,
  'REPORTING_CASE_IDENTITY', 'Retain the original case ID, case version and selected native plan revision.');
  need(plan.id === program.planId && plan.revision === program.planRevision &&
    hash.test(plan.contentSha256 || '') && object(plan.scenario) && object(plan.planning),
  'REPORTING_CASE_PLAN', 'The case’s complete planning snapshot must match its original selected plan ID and revision.');
  need(['OPERATIONS', 'WALKTHROUGH'].includes(program.mode), 'REPORTING_CASE_MODE',
    'Retain the native case’s Operations or Walkthrough mode.');
  text(program.name, 'the original case name', 300, true);
  const kinds = ['contributors', 'work', 'invoices', 'cash', 'awards', 'deployments', 'purchases', 'outcomes'];
  for (const kind of kinds) need(Array.isArray(current.records[kind]), 'REPORTING_CASE_RECORDS',
    'Retain the complete original ' + kind + ' records.', { kind });
  const sources = Array.isArray(current.sources) ? current.sources : Object.values(current.sources);
  need(sources.every(source => object(source) && typeof source.id === 'string' && hash.test(source.sha256 || '')),
    'REPORTING_CASE_SOURCES', 'Retain the original case source identities and content SHA-256 values.');
  return copy(current);
}

async function selectedTables(book) {
  const result = [];
  for (const binding of book.bindings) {
    const document = book.project.documents.find(row => row.id === binding.documentId);
    const edition = selectedEdition(document);
    const review = document.selectedReviewId ? selectedReview(document) : null;
    const selectionId = book.selectedWorkbooks?.[document.id];
    const worksheet = selectionId ? book.workbookSelections?.find(row => row.id === selectionId) : null;
    const workbook = worksheet ? book.workbookSources?.find(row => row.id === worksheet.sourceId) : null;
    result.push({ role: binding.role, documentId: document.id, resourceId: document.resourceId,
      label: document.label, filename: edition.filename, editionId: edition.id, sha256: edition.sha256,
      bytes: edition.bytes, reviewId: review?.id ?? null, reviewCurrent: reviewIsCurrent(document),
      mappingSha256: await sha256(canonical(document.mapping)), bindingSha256: await sha256(canonical(binding)),
      mode: binding.mode,
      ...(worksheet ? { workbook: { sourceId: workbook.id, filename: workbook.filename,
        sha256: workbook.sha256, bytes: workbook.bytes, selectionId: worksheet.id,
        selectionSha256: worksheet.sha256 } } : {}) });
  }
  return result;
}

/** Validates native source projects through the original importer and retains their selected lineage. */
export async function inspectGrantReportingInput(value) {
  const retained = await grantReportingPreparationInput(value), input = retained.input;
  const catalog = input.catalog;
  need(catalog?.schema === CATALOG_SCHEMA && object(catalog.package) &&
    Array.isArray(catalog.items) && Array.isArray(catalog.sources), 'REPORTING_CATALOG',
    'Refresh the selected toolkit catalog or open its complete Toolkit catalog JSON export.');
  const missing = ['command:grant-workspace', 'command:grant-source-tables', 'command:discover']
    .filter(id => !catalog.items.some(item => item.id === id && item.kind === 'command'));
  need(!missing.length, 'REPORTING_REGISTRATIONS',
    'The selected toolkit is missing ' + missing.join(', ') +
    '. Open a current Grant Operations installation that includes Command finder and Source Tables, then export its complete catalog.',
    { missing });
  need(object(input.paths), 'REPORTING_PATHS', 'Enter the original workspace, source project, reporting directory, receiving workspace and browser address.');
  const paths = Object.fromEntries(['workspace', 'sourceProject', 'outputDirectory', 'receivingWorkspace']
    .map(key => [key, absolutePath(input.paths[key], key)]));
  const browser = finderURL(input.paths.commandFinderUrl);
  paths.commandFinderUrl = browser.url;
  const current = originalCase(input.case);
  const book = await importPlanningBook(input.sourceProject);
  need(book.baseline.id === current.plan.id, 'REPORTING_SOURCE_PLAN',
    'The Source Tables project belongs to a different native plan. Select the original source project for this Grant case.',
    { casePlanId: current.plan.id, sourcePlanId: book.baseline.id });
  const startDate = date(input.startDate, 'The first reporting date', true);
  const asOfDate = date(input.asOfDate, 'The reporting end date');
  need(!startDate || startDate <= asOfDate, 'REPORTING_PERIOD', 'The reporting start date must be on or before the end date.');
  const id = identity(input.id, 'The operating plan ID');
  const savedAt = time(input.savedAt ?? new Date().toISOString(), 'The operating plan creation time');
  const fields = Object.fromEntries(['title', 'customer', 'period', 'owner', 'receiving'].map(key =>
    [key, text(input[key] ?? '', key, ['title', 'owner'].includes(key) ? 300 : key === 'receiving' ? 32000 : 1000,
      key === 'title')]));
  const sourceRoot = input.sourceRoot == null ? null : absolutePath(input.sourceRoot, 'the selected source checkout');
  const sourceSelection = input.sourceSelection == null ? null : identity(input.sourceSelection, 'the source selection ID');
  const selection = {
    case: { id: current.program.id, name: current.program.name, version: current.program.version,
      mode: current.program.mode, state: current.program.state,
      contentSha256: await sha256(canonical(current)) },
    plan: { id: current.plan.id, revision: current.plan.revision, contentSha256: current.plan.contentSha256 },
    sourceProject: { id: book.id, name: book.name, contentSha256: await sha256(canonical(book)),
      baseline: { id: book.baseline.id, revision: book.baseline.revision,
        contentSha256: book.baseline.contentSha256 },
      sameSelectedPlan: book.baseline.revision === current.plan.revision &&
        book.baseline.contentSha256 === current.plan.contentSha256,
      tables: await selectedTables(book) },
    reporting: { startDate, asOfDate },
    paths: copy(paths), browserOrigin: browser.origin,
    ...(retained.retainedFiles ? { originalFiles: retained.retainedFiles } : {}),
  };
  return { input: { catalog: copy(catalog), case: current, sourceProject: book, paths,
    id, savedAt, ...fields, ...(startDate ? { startDate } : {}), asOfDate, sourceRoot, sourceSelection },
  selection, preview: retained.preview };
}

/** A portable preview must be exactly the procedure rebuilt from its retained inputs. */
export function requireSameGrantReportingPreview(preview, generated) {
  if (preview !== null && preview !== undefined)
    need(same(inspectOperatingPlan(preview), inspectOperatingPlan(generated)),
      'REPORTING_PREVIEW_CHANGED',
      'The saved preview differs from its complete retained preparation. Open and rebuild that preparation before creating the plan.');
  return generated;
}
