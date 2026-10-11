// MIT. Customer operations over the original QuickBooks and Xero accountant controllers.
import { createHash } from 'node:crypto';
import { XeroWorkspace } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/xero-workspace.mjs';
import { XeroHttpClient, XERO_ACCESS_TOKEN_ENV } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/xero-http.mjs';
import { createXeroContext, compareXeroJournals, xeroCanonical, xeroId, xeroText } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/xero.mjs';
import { QboWorkspace } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/qbo-workspace.mjs';
import { QboHttpClient, QBO_ACCESS_TOKEN_ENV } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/qbo-http.mjs';
import { normalizeQboCompany } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/qbo-company.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$' };
const sha256 = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision = { type: 'integer', minimum: 1 };
const actor = { type: 'string', minLength: 1, maxLength: 1000 };
const name = { type: 'string', minLength: 1, maxLength: 160 };
const timestamp = { type: 'string', minLength: 1, maxLength: 80 };
const nullableId = { anyOf: [uuid, { type: 'null' }] };
const realmId = { type: 'string', pattern: '^[0-9]{1,64}$' };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };
const base = { workspace: alias };
const selectedPlan = { ...base, planId: uuid };
const source = { source: alias, sourceSha256: sha256 };
const companySource = { companySource: alias, companySourceSha256: sha256 };
const sourcePlan = { ...base, ...source, ...companySource };
const response = { ...selectedPlan, ...source, id: uuid, name, actor, createdAt: timestamp, realmId, expectedParentId: nullableId };
const readOnly = { readOnly: true, idempotent: true };
const view = values => ({ type: 'string', enum: values });
const qboPlanViews = ['summary', 'rows', 'lines', 'responses', 'files', 'accounts', 'native-attempts'];
const responseViews = ['summary', 'errors', 'issues', 'rows'];
export const platformFileNames = ['plan.json', 'journal-entry.json', 'handoff.json', 'accountant.csv', 'accountant-return.json',
  'review.html', 'response.json', 'result.json', 'returned.csv', 'return-request.json', 'intent.json', 'request.json', 'receipt.json'];

export const platformDefinitions = [
  ['merchant_accounting_qbo_connection', 'Read the original configured QuickBooks company/environment and native credential availability. Returns environment-variable names without credential values; no provider request is sent.', { ...base }, ['workspace'], readOnly],
  ['merchant_accounting_qbo_company_fetch', 'Fetch the original connected QuickBooks CompanyInfo, Preferences and complete paged native chart, including inactive accounts. Each invocation performs native reads; pin expectedCompanySha256 when comparing pages. Default output is compact; snapshot view returns the full original validated company and source documents for the operator to retain in the host-declared journal input.', { ...base, realmId, environment: view(['sandbox', 'production']), expectedCompanySha256: sha256, view: view(['summary', 'accounts', 'snapshot']), ...page }, ['workspace', 'realmId', 'environment'], readOnly],
  ['merchant_accounting_qbo_post_preview', 'Preview native posting of the exact original reviewed journal to its configured QuickBooks company. Keep the original posting UUID/time, current accountant parent and revision. Returns the native request/plan digests and exact post command; no provider request is sent.', { ...selectedPlan, revision, id: uuid, actor, createdAt: timestamp, expectedParentId: nullableId }, ['workspace', 'planId', 'revision', 'id', 'actor', 'createdAt', 'expectedParentId'], readOnly],
  ['merchant_accounting_qbo_post', 'Execute the explicitly reviewed original native posting using its exact UUID/time, native preview digest, current parent and workspace revision. The original controller retains the request and native attempts, searches for the exact journal, and links the original accountant return. Reconcile the retained nativePost before an uncertain reply is retried.', { ...selectedPlan, revision, id: uuid, actor, createdAt: timestamp, expectedParentId: nullableId, previewSha256: sha256 }, ['workspace', 'planId', 'revision', 'id', 'actor', 'createdAt', 'expectedParentId', 'previewSha256'], { idempotent: true }],
  ['merchant_accounting_qbo_post_resume', 'Explicitly continue one retained original native posting. This may perform native query/read and the original allowed POST, so it is an execution action. Keep the selected posting UUID and preview digest; ordinary customer reconciliation reads nativePost without invoking this command. Native throttle and original company/request guards remain authoritative.', { ...selectedPlan, revision, id: uuid, actor, previewSha256: sha256 }, ['workspace', 'planId', 'revision', 'id', 'actor', 'previewSha256'], { idempotent: true }],
  ['merchant_accounting_qbo_status', 'Read the original QuickBooks workspace, retained journals and accountant handoffs. Page full native inventories before choosing a plan; no provider call is started.', { ...base, view: view(['summary', 'plans', 'handoffs']), ...page }, ['workspace'], readOnly],
  ['merchant_accounting_qbo_company_preview', 'Inspect an original host-declared CompanyInfo/Preferences/Account input through the native QuickBooks import. Retains exact source and company hashes in the response, with paged actual chart eligibility. No journal or accountant return is saved.', { ...base, ...source, view: view(['summary', 'accounts']), ...page }, ['workspace', 'source'], readOnly],
  ['merchant_accounting_qbo_handoff', 'Review one original frozen accountant handoff and its current parent before mapping a QuickBooks journal. Page actual payment rows and frozen adjustment context without rewriting its original values.', { ...base, handoffId: uuid, search: { type: 'string', maxLength: 500 }, ...page }, ['workspace', 'handoffId'], readOnly],
  ['merchant_accounting_qbo_preview', 'Preview a host-declared original journal request using the native QuickBooks engine. An optional declared company source binds its exact original company/chart snapshot. Returns the small exact command envelope for creation, stable original plan ID, native preview hash and paged rows/lines/accounts.', { ...sourcePlan, view: view(['summary', 'rows', 'lines', 'accounts']), ...page }, ['workspace', 'source'], readOnly],
  ['merchant_accounting_qbo_create', 'Retain the explicitly reviewed QuickBooks draft using the exact source pins, native preview hash and workspace revision returned by qbo_preview. The source carries its original UUID/time; an uncertain reply reuses that same original journal.', { ...sourcePlan, revision, previewSha256: sha256 }, ['workspace', 'source', 'sourceSha256', 'revision', 'previewSha256'], { idempotent: true }],
  ['merchant_accounting_qbo_plan', 'Read one original QuickBooks journal, retained review/cancellation identities, response history, original files and current accountant parent. Page full responses before reconciling an uncertain import; reading does not submit a posting.', { ...selectedPlan, view: view(qboPlanViews), ...page }, ['workspace', 'planId'], readOnly],
  ['merchant_accounting_qbo_review', 'Record explicit review of the exact original DRAFT journal and reserve its native company/events. Keep a stable review UUID and the retained plan digest; no QuickBooks posting is sent.', { ...selectedPlan, revision, id: uuid, actor, note: { type: 'string', maxLength: 4000 }, planSha256: sha256 }, ['workspace', 'planId', 'revision', 'id', 'actor', 'planSha256'], { idempotent: true }],
  ['merchant_accounting_qbo_cancel', 'Record the operator-confirmed cancellation of an unused original QuickBooks journal. Supply its exact plan digest and explicit unusedConfirmed:true. Native matched or booked returns retain their existing accountant workflow.', { ...selectedPlan, revision, id: uuid, actor, note: { type: 'string', minLength: 1, maxLength: 4000 }, planSha256: sha256, unusedConfirmed: { type: 'boolean', enum: [true] } }, ['workspace', 'planId', 'revision', 'id', 'actor', 'note', 'planSha256', 'unusedConfirmed'], { idempotent: true }],
  ['merchant_accounting_qbo_response_preview', 'Inspect the exact host-declared original QuickBooks response and preview its original accountant return. The stable response UUID/time, realm and current parent remain explicit. Returns source/native preview pins and a command envelope; no provider request is submitted.', { ...response, view: view(responseViews), ...page }, ['workspace', 'planId', 'source', 'id', 'name', 'actor', 'createdAt', 'realmId', 'expectedParentId'], readOnly],
  ['merchant_accounting_qbo_response_save', 'Retain the explicitly previewed original response and apply/link the same accountant return. Carry the exact response UUID/time, original bytes, parent, source SHA256, preview hash and workspace revision. Repeating a saved response may finish its original PENDING return without another provider request.', { ...response, revision, previewSha256: sha256 }, ['workspace', 'planId', 'source', 'sourceSha256', 'id', 'name', 'actor', 'createdAt', 'realmId', 'expectedParentId', 'revision', 'previewSha256'], { idempotent: true }],
  ['merchant_accounting_qbo_response_resume', 'Continue the original retained QuickBooks response/accountant return by its existing plan and response IDs. Uses already retained native bytes and return identity; no new provider request or response import is created.', { ...selectedPlan, responseId: uuid, revision, actor }, ['workspace', 'planId', 'responseId', 'revision', 'actor'], { idempotent: true }],
  ['merchant_accounting_xero_status', 'Read the original Xero contexts, plans, accountant handoffs and connection availability. Page complete retained inventories; no provider call or draft request is started.', { ...base, view: view(['summary', 'contexts', 'plans', 'handoffs']), ...page }, ['workspace'], readOnly],
  ['merchant_accounting_xero_context', 'Read a retained original Xero organization and actual chart eligibility. Validates its original context bytes and provides paged accounts/files.', { ...base, contextId: uuid, view: view(['summary', 'accounts', 'files']), ...page }, ['workspace', 'contextId'], readOnly],
  ['merchant_accounting_xero_context_preview', 'Validate a declared original organization/accounts source through the native context engine. Returns exact source/import request pins and a small command envelope; the context has not been retained.', { ...base, ...source, view: view(['summary', 'accounts']), ...page }, ['workspace', 'source'], readOnly],
  ['merchant_accounting_xero_context_import', 'Retain the explicitly reviewed original organization/account import. Preserve the source bytes, native import request identity and workspace revision. Its stable UUID reconciles an uncertain reply without another import.', { ...base, ...source, revision, previewSha256: sha256 }, ['workspace', 'source', 'sourceSha256', 'revision', 'previewSha256'], { idempotent: true }],
  ['merchant_accounting_xero_context_capture', 'Read the actual native organization and accounts for one host-declared tenant alias and retain them through the original controller. Supply a stable context UUID and the expected native tenant ID from the declared source view. Reconcile that UUID before retrying an uncertain response; capture makes native reads before import.', { ...base, revision, id: uuid, actor, name, tenant: alias, expectedTenantId: uuid }, ['workspace', 'revision', 'id', 'actor', 'name', 'tenant', 'expectedTenantId']],
  ['merchant_accounting_xero_source', 'Review original payment/refund components, current accountant baseline, organization chart and active source reservations. Page actual native source before making inclusion and valuation decisions.', { ...base, handoffId: uuid, contextId: uuid, view: view(['components', 'accounts', 'reserved']), ...page }, ['workspace', 'handoffId', 'contextId'], readOnly],
  ['merchant_accounting_xero_preview', 'Preview a declared original Xero plan using the native source, inclusion/exclusion decisions, valuations and accounts. The source must retain its UUID/time. Returns native plan/source pins, conflicts and a small exact creation command.', { ...base, ...source, view: view(['summary', 'entries', 'excluded', 'journals', 'lines', 'baseline', 'conflicts']), journalIndex: { type: 'integer', minimum: 0 }, ...page }, ['workspace', 'source'], readOnly],
  ['merchant_accounting_xero_create', 'Retain the exact reviewed original Xero plan with its native preview/source hashes and workspace revision. Replays the native normalized request and stable plan UUID; no draft is sent to Xero.', { ...base, ...source, revision, previewSha256: sha256 }, ['workspace', 'source', 'sourceSha256', 'revision', 'previewSha256'], { idempotent: true }],
  ['merchant_accounting_xero_plan', 'Read a retained original Xero plan, journal delivery state, operations, captures, accountant return intents/history and native file inventory. Page full original records before reconciling an uncertain response.', { ...selectedPlan, view: view(['summary', 'entries', 'excluded', 'journals', 'lines', 'baseline', 'operations', 'captures', 'returnIntents', 'returns', 'files']), journalIndex: { type: 'integer', minimum: 0 }, ...page }, ['workspace', 'planId'], readOnly],
  ['merchant_accounting_xero_cancel', 'Cancel an unused original Xero plan after explicit noExternalImport:true confirmation. The original controller rejects attempted or observed delivery and retains the recorded reason and original source.', { ...selectedPlan, revision, actor, reason: { type: 'string', minLength: 1, maxLength: 2000 }, noExternalImport: { type: 'boolean', enum: [true] } }, ['workspace', 'planId', 'revision', 'actor', 'reason', 'noExternalImport'], { idempotent: true }],
  ['merchant_accounting_xero_operate', 'Start one explicit original create-drafts or refresh operation for the retained plan and host-declared tenant. Preserve the stable operation UUID, action and exact plan digest. Creation uses the original native preflight and retained idempotency keys; an uncertain journal is not automatically resent.', { ...selectedPlan, revision, id: uuid, actor, tenant: alias, action: view(['create-drafts', 'refresh']), planSha256: sha256 }, ['workspace', 'planId', 'revision', 'id', 'actor', 'tenant', 'action', 'planSha256'], { idempotent: true }],
  ['merchant_accounting_xero_operation', 'Read the original retained Xero operation directly by its existing ID, with paged journal indexes/source files. RUNNING/COMPLETE/FAILED/INTERRUPTED and native errors retain their original meaning. This never starts or refreshes a provider request.', { ...selectedPlan, operationId: uuid, view: view(['summary', 'indexes', 'files', 'journalSources']), ...page }, ['workspace', 'planId', 'operationId'], readOnly],
  ['merchant_accounting_xero_response_preview', 'Compare a host-declared original response-file set against the original Xero plan. Returns the exact original capture/import binding and a small command envelope; no comparison or accountant return is saved.', { ...selectedPlan, ...source, view: view(['summary', 'journals', 'lines', 'issues', 'unassigned', 'files']), journalIndex: { type: 'integer', minimum: 0 }, ...page }, ['workspace', 'planId', 'source'], readOnly],
  ['merchant_accounting_xero_response_import', 'Retain the explicitly reviewed original native response-file set and comparison under its stable capture UUID. Source/import pins bind the same actor and original bytes; repeated import reopens the original comparison without a provider request.', { ...selectedPlan, ...source, revision, previewSha256: sha256 }, ['workspace', 'planId', 'source', 'sourceSha256', 'revision', 'previewSha256'], { idempotent: true }],
  ['merchant_accounting_xero_comparison', 'Read an original retained Xero response comparison and exact native journal statuses. Page journals, lines, issues, unassigned records or source files without calling the provider.', { ...selectedPlan, captureId: uuid, view: view(['summary', 'journals', 'lines', 'issues', 'unassigned', 'files']), journalIndex: { type: 'integer', minimum: 0 }, ...page }, ['workspace', 'planId', 'captureId'], readOnly],
  ['merchant_accounting_xero_return_preview', 'Preview the original accountant return from a retained native comparison. Keeps later human edits through the original three-way merge. Returns the exact native return hash and CSV SHA256 plus a small application command; full CSV bytes stay in the original engine.', { ...selectedPlan, captureId: uuid, id: uuid, actor, name, createdAt: timestamp, expectedParentId: nullableId, view: view(['summary', 'conflicts', 'skipped', 'assignments', 'results', 'issues', 'missingRows']), ...page }, ['workspace', 'planId', 'captureId', 'id', 'actor', 'name', 'createdAt', 'expectedParentId'], readOnly],
  ['merchant_accounting_xero_return_apply', 'Apply the explicitly reviewed original accountant return using the native preview hash, exact CSV digest, original return UUID/time/current parent and workspace revision. Existing retained intents recover their same original import; no provider request is submitted.', { ...selectedPlan, captureId: uuid, id: uuid, actor, name, createdAt: timestamp, expectedParentId: nullableId, revision, previewSha256: sha256, csvSha256: sha256 }, ['workspace', 'planId', 'captureId', 'id', 'actor', 'name', 'createdAt', 'expectedParentId', 'revision', 'previewSha256', 'csvSha256'], { idempotent: true }],
  ['merchant_accounting_xero_return_resume', 'Complete an already retained original accountant return intent. Select its original plan, capture, return ID and preview hash. Reads the exact saved request and lets the original accountant apply/link recover it; creates no new return identity or provider request.', { ...selectedPlan, captureId: uuid, returnId: uuid, previewSha256: sha256 }, ['workspace', 'planId', 'captureId', 'returnId', 'previewSha256'], { idempotent: true }],
];

function pageOf(items, args, viewName) {
  const offset = args.offset ?? 0, limit = args.limit ?? 25;
  return { view: viewName, total: items.length, offset, limit, items: items.slice(offset, offset + limit) };
}
function handoffBrief(value) {
  const { revisions, ...record } = value;
  return { ...record, returnCount: revisions?.length ?? 0, latestReturn: revisions?.at(-1) ?? null };
}
function qboPostBrief(value) {
  if (!value) return null;
  const { files = [], attempts = [], ...operation } = value;
  return { ...operation, fileCount: files.length, attemptCount: attempts.length, files,
    attempts: attempts.slice(-5) };
}
function qboBrief(value) {
  const { eventIds, responses, nativePost, ...record } = value;
  return { ...record, eventCount: eventIds?.length ?? 0, responseCount: responses?.length ?? 0,
    responses: (responses ?? []).slice(-10), nativePost: qboPostBrief(nativePost) };
}
function companyView(company, args = {}) {
  const { sourceDocuments, accounts, ...value } = company;
  return { ...value, accountCount: accounts.length,
    ...(args.view === 'accounts' ? { page: pageOf(accounts, args, 'accounts') } : {}) };
}
function planView(detail, args = {}) {
  const { rows = [], journalEntry = {}, companySnapshot, ...plan } = detail.plan;
  const record = qboBrief(detail.record), responses = detail.responses ?? detail.record.responses ?? [];
  const files = [
    ...(detail.record.files ?? []).map(file => ({ ...file, planId: detail.record.id })),
    ...responses.flatMap(response => (response.files ?? []).map(file => ({ ...file, planId: detail.record.id, responseId: response.id }))),
    ...(detail.record.nativePost?.files ?? []).map(file => ({ ...file, planId: detail.record.id, nativePost: true })),
    ...(detail.record.nativePost?.attempts ?? []).flatMap(attempt => (attempt.files ?? []).map(file =>
      ({ ...file, planId: detail.record.id, nativePost: true, attemptId: attempt.id })))
  ];
  const result = { revision: detail.revision, expectedParentId: detail.expectedParentId, record,
    plan: { ...plan, rowCount: rows.length, journalEntry: { ...journalEntry, Line: undefined },
      lineCount: journalEntry.Line?.length ?? 0,
      companySnapshot: companySnapshot ? companyView(companySnapshot) : null },
    counts: { rows: rows.length, lines: journalEntry.Line?.length ?? 0, responses: responses.length, files: files.length, accounts: companySnapshot?.accounts?.length ?? 0, nativeAttempts: detail.record.nativePost?.attempts?.length ?? 0 } };
  const selected = args.view ?? 'summary';
  if (selected !== 'summary') result.page = pageOf({ rows, lines: journalEntry.Line ?? [], responses, files, accounts: companySnapshot?.accounts ?? [], 'native-attempts': detail.record.nativePost?.attempts ?? [] }[selected], args, selected);
  return result;
}
function qboResult(value) {
  return { ...value, ...(value.record ? { record: qboBrief(value.record) } : {}), ...(Object.hasOwn(value, 'nativePost') ? { nativePost: qboPostBrief(value.nativePost) } : {}) };
}
function inspectedView(value, args = {}) {
  const { rows = [], errors = [], issues = [], ...result } = value;
  const selected = args.view ?? 'summary';
  return { ...result, counts: { rows: rows.length, errors: errors.length, issues: issues.length },
    ...(selected !== 'summary' ? { page: pageOf({ rows, errors, issues }[selected], args, selected) } : {}) };
}
function command(tool, argumentsValue) { return { tool, arguments: argumentsValue }; }


function exactObject(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Use the declared ' + label + ' fields.');
}
export function normalizePlatformConfig(raw) {
  if (raw === undefined || raw === null) return { qbo: null, xero: null };
  exactObject(raw, ['qbo', 'xero'], 'bookkeeping platform');
  let qbo = null, xero = null;
  if (raw.qbo !== undefined && raw.qbo !== null) {
    exactObject(raw.qbo, ['tokenEnv', 'realmId', 'environment', 'minorVersion'], 'native QuickBooks configuration');
    const tokenEnv = raw.qbo.tokenEnv ?? QBO_ACCESS_TOKEN_ENV, realmId = raw.qbo.realmId,
      environment = raw.qbo.environment ?? 'sandbox', minorVersion = raw.qbo.minorVersion ?? null;
    if (typeof tokenEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(tokenEnv) ||
        typeof realmId !== 'string' || !/^[0-9]{1,64}$/.test(realmId) ||
        !['sandbox', 'production'].includes(environment) ||
        (minorVersion !== null && !/^[1-9][0-9]{0,3}$/.test(String(minorVersion))))
      throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare the exact native QuickBooks company, environment and token variable, with its optional minor version.');
    qbo = { tokenEnv, realmId, environment, minorVersion: minorVersion === null ? null : String(minorVersion) };
  }
  if (raw.xero !== undefined && raw.xero !== null) {
    exactObject(raw.xero, ['tokenEnv', 'tenants'], 'native Xero configuration');
    const tokenEnv = raw.xero.tokenEnv ?? XERO_ACCESS_TOKEN_ENV;
    if (typeof tokenEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(tokenEnv))
      throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare the original Xero token environment-variable name.');
    if (!plain(raw.xero.tenants) || Object.keys(raw.xero.tenants).length > 64)
      throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare up to 64 native Xero tenant aliases.');
    const tenants = Object.create(null), ids = new Set();
    for (const [key, value] of Object.entries(raw.xero.tenants)) {
      if (!new RegExp(alias.pattern).test(key)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Use a valid native Xero tenant alias.');
      const id = xeroId(value);
      if (ids.has(id)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare each native Xero tenant once.');
      ids.add(id); tenants[key] = id;
    }
    xero = { tokenEnv, tenants };
  }
  return { qbo, xero };
}
export function platformSourceView(definition) {
  return { quickbooks: 'ORIGINAL_WORKSPACE',
    qbo: { nativeConfigured: Boolean(definition?.qbo), realmId: definition?.qbo?.realmId ?? null,
      environment: definition?.qbo?.environment ?? null, minorVersion: definition?.qbo?.minorVersion ?? null },
    xero: { nativeConfigured: Boolean(definition?.xero),
      tenants: Object.entries(definition?.xero?.tenants ?? {}).map(([alias, tenantId]) => ({ alias, tenantId })) } };
}
function xeroState(value) {
  return { revision: value.revision, connection: value.connection, docs: value.docs,
    counts: { handoffs: value.handoffs.length, contexts: value.contexts.length, plans: value.plans.length },
    handoffs: value.handoffs.slice(-10), contexts: value.contexts.slice(-10), plans: value.plans.slice(-10) };
}
function operationBrief(value) {
  const { indexes = [], files = [], journalSources = {}, ...operation } = value;
  return { ...operation, counts: { indexes: indexes.length, files: files.length, journalSources: Object.keys(journalSources).length } };
}
function xeroRecord(value) {
  const { componentIds = [], files = [], journals = [], operations = [], captures = [], returnIntents = [], returns = [], ...record } = value;
  return { ...record, counts: { components: componentIds.length, files: files.length, journals: journals.length, operations: operations.length,
    captures: captures.length, returnIntents: returnIntents.length, returns: returns.length },
    operations: operations.slice(-5).map(operationBrief), captures: captures.slice(-5), returnIntents: returnIntents.slice(-5), returns: returns.slice(-5) };
}
function xeroContextView(context, args = {}) {
  const { accounts, ...result } = context;
  return { ...result, accountCount: accounts.length, eligibleAccountCount: accounts.filter(row => row.eligible).length,
    ...(args.view === 'accounts' ? { page: pageOf(accounts, args, 'accounts') } : {}) };
}
function journalBrief(value) {
  const { payload, native, ...journal } = value;
  const lines = payload?.JournalLines ?? native?.JournalLines;
  return { ...journal, ...(payload ? { payload: { ...payload, JournalLines: undefined } } : {}),
    ...(native ? { native: { ManualJournalID: native.ManualJournalID, Date: native.Date, DateString: native.DateString,
      Status: native.Status, Narration: native.Narration, LineAmountTypes: native.LineAmountTypes,
      ShowOnCashBasisReports: native.ShowOnCashBasisReports } } : {}), lineCount: lines?.length ?? 0 };
}
function xeroPlanView(value, args = {}) {
  const { entries, excluded, journals, baseline, ...plan } = value.plan, record = value.record;
  const selected = args.view ?? 'summary';
  const result = { plan, ...(record ? { record: xeroRecord(record) } : {}), ...(value.state ? { state: xeroState(value.state) } : {}),
    counts: { entries: entries.length, excluded: excluded.length, journals: journals.length, baseline: baseline.length } };
  if (selected !== 'summary') {
    let items;
    if (selected === 'lines') {
      if (args.journalIndex === undefined || !journals[args.journalIndex]) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Select an original journalIndex for its paged lines.');
      items = journals[args.journalIndex].payload.JournalLines;
      result.journal = journalBrief(journals[args.journalIndex]);
    } else items = { entries, excluded, journals: journals.map(journal => ({ ...journalBrief(journal), ...(record ? { delivery: (() => {
      const { sourceFiles = [], ...delivery } = record.journals[journal.index]; return { ...delivery, sourceFileCount: sourceFiles.length };
    })() } : {}) })), baseline, conflicts: value.conflicts ?? [],
      operations: (record?.operations ?? []).map(operationBrief), captures: record?.captures ?? [], returnIntents: record?.returnIntents ?? [],
      returns: record?.returns ?? [], files: record?.files ?? [] }[selected];
    result.page = pageOf(items, args, selected);
  }
  return result;
}
function xeroComparisonView(value, args = {}) {
  const { journals, unassigned, files, ...result } = value, selected = args.view ?? 'summary';
  const answer = { ...result, counts: { journals: journals.length, unassigned: unassigned.length, files: files.length } };
  if (selected !== 'summary') {
    let items;
    if (selected === 'lines') {
      const journal = journals.find(row => row.index === args.journalIndex);
      if (!journal) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Select an original journalIndex from this comparison.');
      answer.journal = journalBrief(journal); items = journal.native?.JournalLines ?? [];
    } else items = { journals: journals.map(journalBrief), unassigned, files,
      issues: journals.flatMap(row => row.issues.map(message => ({ index: row.index, journalId: row.journalId, message }))) }[selected];
    answer.page = pageOf(items, args, selected);
  }
  return answer;
}
function xeroResult(value) {
  return { ...value, ...(value.record ? { record: xeroRecord(value.record) } : {}),
    ...(value.plan ? { plan: xeroPlanView({ plan: value.plan }).plan } : {}),
    ...(value.state ? { state: xeroState(value.state) } : {}),
    ...(value.comparison ? { comparison: xeroComparisonView(value.comparison) } : {}),
    ...(value.operation ? { operation: operationBrief(value.operation) } : {}) };
}
function decodeNativeFile(value, label) {
  if (typeof value !== 'string' || value.length > Math.ceil(64_000_000 * 4 / 3) + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw fail('INVALID_XERO_UPLOAD', 'Use the exact original base64 ' + label + ' bytes.');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > 64_000_000 || bytes.toString('base64') !== value)
    throw fail('INVALID_XERO_UPLOAD', 'Use the exact original base64 ' + label + ' bytes.');
  return bytes;
}
function xeroReturnView(value, args = {}) {
  const { csvBase64, ...request } = value.request;
  const selected = args.view ?? 'summary', original = value.preview;
  return { request, previewSha256: value.previewSha256, workspaceRevision: value.workspaceRevision, planId: value.planId, captureId: value.captureId,
    matchedRows: value.matchedRows, conflicts: value.conflicts.length, skipped: value.skipped.length,
    preview: { id: original.id, createdAt: original.createdAt, integrity: original.integrity, summary: original.summary },
    ...(selected !== 'summary' ? { page: pageOf({ conflicts: value.conflicts, skipped: value.skipped, assignments: value.assignments,
      results: original.results ?? [], issues: original.issues ?? [], missingRows: original.missingRows ?? [] }[selected], args, selected) } : {}) };
}

/** The caller supplies only the existing host-alias reader and owning accountant lifetime. */
export class MerchantPlatforms {
  constructor(workspace, accountant, { readSource, definition = { qbo: null, xero: null } }) {
    this.workspace = workspace;
    this.accountant = accountant;
    this.readSource = readSource;
    this.qbo = new QboWorkspace(workspace, accountant, { client: new QboHttpClient(definition.qbo ?? { realmId: '', environment: 'sandbox', minorVersion: null }) });
    this.definition = definition;
    this.xero = new XeroWorkspace(workspace, accountant, { client: new XeroHttpClient({ tokenEnv: definition.xero?.tokenEnv ?? XERO_ACCESS_TOKEN_ENV }) });
  }
  async init() { await this.qbo.recover(); await this.xero.init(); }
  async close() {
    const outcomes = await Promise.allSettled([this.qbo.close(), this.xero.close()]);
    const failed = outcomes.find(value => value.status === 'rejected');
    if (failed) throw failed.reason;
  }
  qboConnection() {
    if (!this.definition.qbo) throw fail('ACCOUNTING_QBO_CONNECTION_REQUIRED', 'Declare this original native QuickBooks company in the host workspace configuration.');
    return this.qbo.connection();
  }
  async input(args, key = 'source', shaKey = 'sourceSha256', { maximum = 33_554_432, json = true } = {}) {
    const bytes = await this.readSource(args[key], maximum), sha = hash(bytes);
    if (args[shaKey] !== undefined && args[shaKey] !== sha)
      throw fail('ACCOUNTING_PLATFORM_SOURCE_CHANGED', 'The declared original source changed. Review its current exact bytes before continuing.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw fail('ACCOUNTING_PLATFORM_SOURCE_UTF8', 'Use the original UTF-8 source file.'); }
    let value;
    if (json) {
      try { value = JSON.parse(text.startsWith('\uFEFF') ? text.slice(1) : text); }
      catch { throw fail('ACCOUNTING_PLATFORM_SOURCE_JSON', 'Use the original JSON input for this operation.'); }
      if (!plain(value)) throw fail('ACCOUNTING_PLATFORM_SOURCE_JSON', 'Use one original JSON input object.');
    }
    return { bytes, text, value, pin: { [key]: args[key], [shaKey]: sha }, sha256: sha };
  }
  async qboInput(args) {
    const input = await this.input(args), value = { ...input.value }, pins = { ...input.pin };
    if (typeof value.id !== 'string' || typeof value.createdAt !== 'string')
      throw fail('ACCOUNTING_PLATFORM_REQUEST_IDENTITY', 'The declared journal request needs its original stable id and createdAt before preview.');
    if (args.companySource === undefined && args.companySourceSha256 !== undefined)
      throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'A company source digest requires its declared companySource alias.');
    if (args.companySource !== undefined) {
      const company = await this.input(args, 'companySource', 'companySourceSha256');
      const snapshot = normalizeQboCompany(company.value);
      if (value.companySnapshot !== undefined && value.companySnapshot !== null)
        throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Choose either the request’s retained companySnapshot or a declared companySource.');
      value.companySnapshot = snapshot;
      Object.assign(pins, company.pin);
    }
    return { value, pins };
  }
  tenant(key) {
    const tenants = this.definition.xero?.tenants ?? {};
    if (typeof key !== 'string' || !Object.hasOwn(tenants, key))
      throw fail('ACCOUNTING_XERO_TENANT_NOT_CONFIGURED', 'Choose a host-declared original Xero tenant alias.');
    return tenants[key];
  }
  async xeroContextInput(args) {
    const input = await this.input(args, 'source', 'sourceSha256', { maximum: 96_000_000 }), value = input.value;
    const organizationBytes = decodeNativeFile(value.organizationBase64, 'organization'), accountsBytes = decodeNativeFile(value.accountsBase64, 'accounts');
    const request = { id: xeroId(value.id), name: xeroText(value.name, 'Organization label', 160), actor: xeroText(value.actor, 'Operator', 1000),
      tenantId: xeroId(value.tenantId), organizationSha256: hash(organizationBytes), accountsSha256: hash(accountsBytes) };
    const context = createXeroContext({ ...request, organizationBytes, accountsBytes });
    return { ...input, context, request, previewSha256: hash(xeroCanonical(request)) };
  }
  async xeroPlanInput(args) {
    const input = await this.input(args, 'source', 'sourceSha256', { maximum: 96_000_000 });
    if (typeof input.value.id !== 'string' || typeof input.value.createdAt !== 'string')
      throw fail('ACCOUNTING_PLATFORM_REQUEST_IDENTITY', 'The declared journal request needs its original stable id and createdAt before preview.');
    return { ...input, preview: await this.xero.preview(input.value) };
  }
  async xeroResponseInput(args) {
    const input = await this.input(args, 'source', 'sourceSha256', { maximum: 96_000_000 }), value = input.value;
    const id = xeroId(value.id), actor = xeroText(value.actor, 'Operator', 1000);
    if (!Array.isArray(value.files) || !value.files.length || value.files.length > 1000)
      throw fail('XERO_RESPONSES_REQUIRED', 'Choose the original native journal response files.');
    const responseFiles = value.files.map((file, index) => ({ name: 'response-' + String(index).padStart(4, '0') + '.json',
      bytes: decodeNativeFile(file.base64, 'ManualJournals response') }));
    const requestSha256 = hash(xeroCanonical(responseFiles.map(file => ({ name: file.name, sha256: hash(file.bytes) }))));
    const originalNames = value.files.map(file => xeroText(file.name ?? 'response.json', 'Original filename', 255));
    return { ...input, id, actor, responseFiles, originalNames, requestSha256, previewSha256: hash(xeroCanonical({ id, actor, requestSha256 })) };
  }
  async xeroCall(operation, args) {
    const key = args.workspace;
    switch (operation) {
      case 'merchant_accounting_xero_status': {
        const value = this.xero.view(), selected = args.view ?? 'summary';
        return { ...xeroState(value), ...(selected !== 'summary' ? { page: pageOf(value[selected], args, selected) } : {}) };
      }
      case 'merchant_accounting_xero_context': {
        const context = await this.xero.context(args.contextId), record = structuredClone(this.xero.contextRow(args.contextId));
        return { revision: this.workspace.state.revision, record, context: xeroContextView(context, args),
          ...(args.view === 'files' ? { page: pageOf(record.files, args, 'files') } : {}) };
      }
      case 'merchant_accounting_xero_context_preview': {
        const input = await this.xeroContextInput(args), revision = this.workspace.state.revision;
        return { ...input.pin, revision, previewSha256: input.previewSha256, context: xeroContextView(input.context, args),
          binding: { contextId: input.request.id, requestSha256: input.previewSha256 },
          command: command('merchant_accounting_xero_context_import', { workspace: key, ...input.pin, revision, previewSha256: input.previewSha256 }) };
      }
      case 'merchant_accounting_xero_context_import': {
        const input = await this.xeroContextInput(args);
        if (input.previewSha256 !== args.previewSha256) throw fail('XERO_CONTEXT_REQUEST_CONFLICT', 'Keep the exact reviewed original context import.');
        return { ...xeroResult(await this.xero.importContext({ ...input.value, revision: args.revision })), ...input.pin };
      }
      case 'merchant_accounting_xero_context_capture': {
        const tenantId = this.tenant(args.tenant);
        if (tenantId !== args.expectedTenantId) throw fail('ACCOUNTING_XERO_TENANT_MISMATCH', 'The declared native tenant differs from the reviewed original tenant identity.');
        return xeroResult(await this.xero.captureContext({ ...args, tenantId }));
      }
      case 'merchant_accounting_xero_source': {
        const value = await this.xero.source(args.handoffId, args.contextId), { rows, ...handoff } = value.handoff;
        const selected = args.view ?? 'components';
        return { handoffId: value.handoffId, contextId: value.contextId, accountantRevisionId: value.accountantRevisionId,
          handoff: { ...handoff, rowCount: rows.length }, context: xeroContextView(value.context),
          counts: { components: value.components.length, accounts: value.context.accounts.length, reservations: value.reserved.length },
          page: pageOf({ components: value.components, accounts: value.context.accounts, reserved: value.reserved }[selected], args, selected) };
      }
      case 'merchant_accounting_xero_preview': {
        const input = await this.xeroPlanInput(args), preview = input.preview;
        return { ...xeroPlanView(preview, args), ...input.pin, workspaceRevision: preview.workspaceRevision,
          previewSha256: preview.previewSha256, conflictCount: preview.conflicts.length,
          binding: { planId: preview.request.id, requestSha256: hash(xeroCanonical(preview.request)), planSha256: preview.plan.sha256 },
          command: command('merchant_accounting_xero_create', { workspace: key, ...input.pin,
            revision: preview.workspaceRevision, previewSha256: preview.previewSha256 }) };
      }
      case 'merchant_accounting_xero_create': {
        const input = await this.xeroPlanInput(args);
        if (input.preview.previewSha256 !== args.previewSha256) throw fail('XERO_PREVIEW_CHANGED', 'Keep the exact reviewed original Xero journal plan.');
        return { ...xeroResult(await this.xero.create({ ...input.preview.request, revision: args.revision, previewSha256: args.previewSha256 })), ...input.pin };
      }
      case 'merchant_accounting_xero_plan':
        return xeroPlanView(await this.xero.detail(args.planId), args);
      case 'merchant_accounting_xero_cancel':
        return xeroResult(await this.xero.cancel(args.planId, args));
      case 'merchant_accounting_xero_operate': {
        const plan = await this.xero.plan(args.planId);
        if (plan.context.tenantId !== this.tenant(args.tenant)) throw fail('ACCOUNTING_XERO_TENANT_MISMATCH', 'The selected native tenant alias must match the original retained plan.');
        return xeroResult(await this.xero.operate(args.planId, args));
      }
      case 'merchant_accounting_xero_operation': {
        const value = structuredClone(this.xero.operation(args.planId, args.operationId)), selected = args.view ?? 'summary';
        return { operation: operationBrief(value), ...(selected !== 'summary' ? { page: pageOf({
          indexes: value.indexes, files: value.files, journalSources: Object.entries(value.journalSources).map(([index, files]) => ({ index: Number(index), files }))
        }[selected], args, selected) } : {}) };
      }
      case 'merchant_accounting_xero_response_preview': {
        const input = await this.xeroResponseInput(args), plan = await this.xero.plan(args.planId);
        const comparison = compareXeroJournals({ id: input.id, actor: input.actor, plan, responseFiles: input.responseFiles,
          source: { kind: 'operator-file', tenantId: plan.context.tenantId, requestSha256: input.requestSha256, originalNames: input.originalNames } });
        const revision = this.workspace.state.revision;
        return { comparison: xeroComparisonView(comparison, args), ...input.pin, revision, previewSha256: input.previewSha256,
          binding: { planId: args.planId, captureId: input.id, actor: input.actor, requestSha256: input.requestSha256 },
          command: command('merchant_accounting_xero_response_import', { workspace: key, planId: args.planId, ...input.pin, revision, previewSha256: input.previewSha256 }) };
      }
      case 'merchant_accounting_xero_response_import': {
        const input = await this.xeroResponseInput(args);
        if (input.previewSha256 !== args.previewSha256) throw fail('XERO_CAPTURE_REQUEST_CONFLICT', 'Keep the exact reviewed original native response import.');
        return { ...xeroResult(await this.xero.importResponses(args.planId, { ...input.value, id: input.id, actor: input.actor, revision: args.revision })), ...input.pin };
      }
      case 'merchant_accounting_xero_comparison':
        return { comparison: xeroComparisonView(await this.xero.comparison(args.planId, args.captureId), args) };
      case 'merchant_accounting_xero_return_preview': {
        const preview = await this.xero.returnPreview(args.planId, args.captureId, args);
        const csvSha256 = hash(Buffer.from(preview.request.csvBase64, 'base64'));
        const { csvBase64, ...request } = preview.request;
        return { ...xeroReturnView(preview, args), csvSha256,
          binding: { planId: args.planId, captureId: args.captureId, returnId: request.id, previewSha256: preview.previewSha256, csvSha256 },
          command: command('merchant_accounting_xero_return_apply', { workspace: key, planId: args.planId, captureId: args.captureId, ...request,
            revision: preview.workspaceRevision, previewSha256: preview.previewSha256, csvSha256 }) };
      }
      case 'merchant_accounting_xero_return_apply': {
        const prior = this.xero.row(args.planId).returnIntents.find(value => value.id === args.id);
        let request;
        if (prior) {
          if (prior.captureId !== args.captureId || prior.previewSha256 !== args.previewSha256)
            throw fail('XERO_RETURN_REQUEST_CONFLICT', 'Choose the exact original accountant return intent.');
          const original = await this.xero.file(args.planId, prior.requestFile);
          request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original.bytes));
        } else {
          const preview = await this.xero.returnPreview(args.planId, args.captureId, args);
          if (preview.previewSha256 !== args.previewSha256) throw fail('XERO_RETURN_PREVIEW_CHANGED', 'Review the current original accountant return.');
          request = preview.request;
        }
        if (hash(Buffer.from(request.csvBase64, 'base64')) !== args.csvSha256)
          throw fail('XERO_RETURN_PREVIEW_CHANGED', 'The original accountant CSV differs from the reviewed bytes.');
        return xeroResult(await this.xero.applyReturn(args.planId, args.captureId, { ...request, previewSha256: args.previewSha256, revision: args.revision }));
      }
      case 'merchant_accounting_xero_return_resume': {
        const prior = this.xero.row(args.planId).returnIntents.find(value => value.id === args.returnId);
        if (!prior || prior.captureId !== args.captureId || prior.previewSha256 !== args.previewSha256)
          throw fail('XERO_RETURN_REQUEST_CONFLICT', 'Choose the exact retained original accountant return intent.');
        return xeroResult(await this.xero.applyReturn(args.planId, args.captureId, { id: args.returnId, previewSha256: args.previewSha256 }));
      }
      default: throw fail('ACCOUNTING_UNKNOWN_TOOL', 'Unknown original Xero bookkeeping operation.');
    }
  }

  async file(args) {
    if (args.kind === 'xero') {
      if (!args.planId || typeof args.file !== 'string' || args.file.length > 100 ||
          !args.file.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== '.' && part !== '..'))
        throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Choose an original Xero plan and exact retained filename from its file inventory.');
      return this.xero.file(args.planId, args.file);
    }
    if (args.kind !== 'qbo') throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Choose the original bookkeeping file kind.');
    if (!args.planId || !platformFileNames.includes(args.file))
      throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'QuickBooks files require the original planId and retained filename.');
    if (args.nativePost === true) {
      const names = args.attemptId ? ['response.json', 'receipt.json'] : ['intent.json', 'request.json'];
      if (args.responseId || !names.includes(args.file))
        throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Use nativePost:true with its original intent/request, or its attemptId and native response/receipt.');
      return this.qbo.nativeFile(args.planId, args.file, args.attemptId);
    }
    if (args.attemptId !== undefined || args.nativePost !== undefined)
      throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'An original native posting file requires nativePost:true.');
    return this.qbo.file(args.planId, args.file, args.responseId);
  }
  async call(operation, args) {
    if (operation.startsWith('merchant_accounting_xero_')) return this.xeroCall(operation, args);
    switch (operation) {
      case 'merchant_accounting_qbo_connection':
        return { ...this.qbo.connection(), configured: Boolean(this.definition.qbo) };
      case 'merchant_accounting_qbo_company_fetch': {
        this.qboConnection();
        const result = await this.qbo.fetchCompany({ realmId: args.realmId, environment: args.environment });
        if (args.expectedCompanySha256 !== undefined && args.expectedCompanySha256 !== result.company.integrity.sha256)
          throw fail('ACCOUNTING_QBO_COMPANY_CHANGED', 'The native company/chart differs from the selected exact snapshot.');
        return { ...result, company: args.view === 'snapshot' ? result.company : companyView(result.company, args),
          companySha256: result.company.integrity.sha256, observation: 'FRESH_NATIVE_COMPANY_READ' };
      }
      case 'merchant_accounting_qbo_post_preview': {
        this.qboConnection();
        const result = await this.qbo.previewPost(args.planId, args), preview = result.preview;
        return { ...result, binding: { planId: args.planId, postId: preview.id, planSha256: preview.planSha256,
          requestSha256: preview.requestSha256, previewSha256: result.previewSha256 },
          command: command('merchant_accounting_qbo_post', { workspace: args.workspace, planId: args.planId,
            id: preview.id, actor: preview.actor, createdAt: preview.createdAt, expectedParentId: preview.expectedParentId,
            revision: result.revision, previewSha256: result.previewSha256 }) };
      }
      case 'merchant_accounting_qbo_post':
        this.qboConnection(); return qboResult(await this.qbo.post(args.planId, args));
      case 'merchant_accounting_qbo_post_resume': {
        this.qboConnection();
        const prior = this.qbo.row(args.planId).nativePost;
        if (!prior || prior.id !== args.id || prior.previewSha256 !== args.previewSha256)
          throw fail('QBO_NATIVE_REQUEST_CHANGED', 'Choose the exact retained original native posting and preview.');
        return qboResult(await this.qbo.resumePost(args.planId, args));
      }
      case 'merchant_accounting_qbo_status': {
        const value = this.qbo.view(), plans = value.plans.map(qboBrief), handoffs = value.handoffs.map(handoffBrief);
        const selected = args.view ?? 'summary';
        return { revision: value.revision, currencies: value.currencies, docs: value.docs,
          counts: { plans: plans.length, handoffs: handoffs.length }, plans: plans.slice(0, 10), handoffs: handoffs.slice(0, 10),
          ...(selected !== 'summary' ? { page: pageOf({ plans, handoffs }[selected], args, selected) } : {}) };
      }
      case 'merchant_accounting_qbo_company_preview': {
        const input = await this.input(args), company = normalizeQboCompany(input.value);
        return { ...input.pin, company: companyView(company, args) };
      }
      case 'merchant_accounting_qbo_handoff': {
        const { rows, record, ...value } = await this.qbo.handoff(args.handoffId);
        const search = (args.search ?? '').trim().toLocaleLowerCase();
        const selected = search ? rows.filter(row => JSON.stringify(row).toLocaleLowerCase().includes(search)) : rows;
        return { ...value, record: handoffBrief(record), totalRows: rows.length, page: pageOf(selected, args, 'rows') };
      }
      case 'merchant_accounting_qbo_preview': {
        const { value, pins } = await this.qboInput(args), preview = await this.qbo.preview(value);
        const request = { workspace: args.workspace, ...pins, revision: preview.revision, previewSha256: preview.previewSha256 };
        const detail = { revision: preview.revision, expectedParentId: value.expectedParentId ?? null, plan: preview.plan,
          record: { id: preview.plan.id, integrity: preview.plan.integrity, status: 'PREVIEW', eventIds: preview.plan.rows?.map(row => row.eventId) ?? [], responses: [], files: [] } };
        return { ...planView(detail, args), ...pins, previewSha256: preview.previewSha256,
          binding: { planId: preview.plan.id, actor: preview.plan.actor, createdAt: preview.plan.createdAt, previewSha256: preview.previewSha256 },
          command: command('merchant_accounting_qbo_create', request) };
      }
      case 'merchant_accounting_qbo_create': {
        if (args.companySource !== undefined && args.companySourceSha256 === undefined)
          throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Keep the reviewed companySourceSha256 with the companySource alias.');
        const { value, pins } = await this.qboInput(args);
        return { ...qboResult(await this.qbo.create({ ...value, revision: args.revision, previewSha256: args.previewSha256 })), ...pins };
      }
      case 'merchant_accounting_qbo_plan':
        return planView(await this.qbo.detail(args.planId), args);
      case 'merchant_accounting_qbo_review':
        return qboResult(await this.qbo.review(args.planId, args));
      case 'merchant_accounting_qbo_cancel':
        return qboResult(await this.qbo.cancel(args.planId, args));
      case 'merchant_accounting_qbo_response_preview':
      case 'merchant_accounting_qbo_response_save': {
        const input = await this.input(args, 'source', 'sourceSha256', { maximum: 8 * 1024 * 1024, json: false });
        const { workspace, source, sourceSha256, planId, view, offset, limit, ...value } = args;
        value.responseJson = input.text;
        if (operation.endsWith('_save')) return { ...qboResult(await this.qbo.saveResponse(planId, value)), ...input.pin };
        const preview = await this.qbo.previewResponse(planId, value);
        const request = { workspace, planId, ...input.pin, id: args.id, name: args.name, actor: args.actor, createdAt: args.createdAt,
          realmId: args.realmId, expectedParentId: args.expectedParentId, revision: preview.revision, previewSha256: preview.previewSha256 };
        return { revision: preview.revision, ...input.pin, previewSha256: preview.previewSha256, result: inspectedView(preview.result, args),
          binding: { planId, responseId: args.id, responseSha256: input.sha256, previewSha256: preview.previewSha256 },
          command: command('merchant_accounting_qbo_response_save', request) };
      }
      case 'merchant_accounting_qbo_response_resume':
        return qboResult(await this.qbo.resume(args.planId, args.responseId, args));
      default: throw fail('ACCOUNTING_UNKNOWN_TOOL', 'Unknown original bookkeeping operation.');
    }
  }
}
