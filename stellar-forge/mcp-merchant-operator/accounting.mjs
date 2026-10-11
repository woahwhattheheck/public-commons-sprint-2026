// MIT. Agent operations over the retained original merchant accounting workspace.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { bitwaveDefinitions, normalizeBitwaveConfig, bitwaveSourceView, bitwavePathReferences, MerchantBitwave } from './bitwave.mjs';
import { openAccountingWorkspace } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/store.mjs';
import { openCollectionWorkspace } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/collection-workspace.mjs';
import { AccountantWorkspace, ACCOUNTANT_CSV_BYTES } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/accountant-workspace.mjs';
import { MAX_PRICING_REPORT_BYTES } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/pricing.mjs';
import { supportsSellerMethod } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/http-methods.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const sha256 = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const revision = { type: 'integer', minimum: 1 };
const actor = { type: 'string', minLength: 1, maxLength: 240 };
const name = { type: 'string', minLength: 1, maxLength: 160 };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };
const base = { workspace: alias };
const change = { ...base, revision, actor };
const readOnly = { readOnly: true, idempotent: true };
const shortText = { type: 'string', maxLength: 160 };
const timestamp = { type: 'string', minLength: 1, maxLength: 80 };
const nullableId = { anyOf: [uuid, { type: 'null' }] };
const returnSelection = { anyOf: [uuid, { type: 'string', enum: ['initial'] }] };
const periodSelection = { anyOf: [{ type: 'object', properties: { id: uuid, version: revision }, required: ['id', 'version'], additionalProperties: false }, { type: 'null' }] };
const sourceIds = { type: 'array', items: uuid, minItems: 1, maxItems: 2000, uniqueItems: true };
const optionLabel = { type: 'object', properties: { optionId: sha256, assetLabel: shortText, unitLabel: shortText, accountCode: shortText, accountName: shortText }, required: ['optionId'], additionalProperties: false };
const views = ['runs', 'jobs', 'recovered', 'previews', 'proofs', 'terms', 'exports', 'history', 'collectionSources', 'collections', 'collectionJobs', 'pricing', 'periods', 'closes', 'handoffs'];
const sourceKinds = ['recoveredSources', 'recoveryRequests', 'proofFiles', 'termsFiles', 'pricingReports', 'accountantReturns'];
const reportNames = ['report.json', 'ledger.csv', 'options.csv', 'exceptions.csv', 'review.html', 'manifest.json'];
const periodNames = ['period-close.json', 'review-notes.json'];
const accountantNames = ['handoff.json', 'accountant.csv', 'review.html', 'original-report.json', 'original-manifest.json', 'input-manifest.json', 'packet-manifest.json', 'accountant-handoff.tar', 'period-close.json', 'review-notes.json', 'returned.csv', 'return.json'];
const fileSelections = ['runId', 'recoveryId', 'exportId', 'collectionId', 'sourceId', 'reviewId', 'closeId', 'handoffId', 'revisionId', 'file'];
const supportedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(supportsSellerMethod);

const definitions = [
  ...bitwaveDefinitions,
  ['merchant_accounting_sources', 'List host-configured accounting workspaces and named recovery, verification, collection, pricing, accountant-return and Bitwave inputs. Returns aliases and ownership without local paths or source bytes.', { workspace: alias }, [], readOnly],
  ['merchant_accounting_open', 'Open or initialize a declared original accounting workspace and acquire its existing exclusive lease. Reopens its retained reconciliations, recovery jobs and reviews; does not call RPC or purchase a resource.', base, ['workspace'], { idempotent: true }],
  ['merchant_accounting_close', 'Release only this MCP process-owned accounting workspace. Stops its pending read-only recovery verification and waits for retained reconciliation and current reads to finish before releasing the lease.', base, ['workspace'], { destructive: true, idempotent: true }],
  ['merchant_accounting_status', 'Read the current workspace revision, retained job/run status and source aliases. Choose a paged view for jobs, recovery reviews, recovered entries, reconciliations, proofs, terms, exports or history.', { ...base, view: { type: 'string', enum: ['summary', ...views] }, ...page }, ['workspace'], readOnly],
  ['merchant_accounting_input_import', 'Import a declared original SF86 verification file or merchant terms file into this workspace. Uses the original parser, eligibility and terms selection; preserves original payment classification.', { ...change, kind: { type: 'string', enum: ['proof', 'terms'] }, source: alias }, ['workspace', 'revision', 'actor', 'kind', 'source']],
  ['merchant_accounting_input_select', 'Select original source terms or a retained terms import, or include/exclude a retained original proof. Pass selection from current state; proof selection also requires included.', { ...change, kind: { type: 'string', enum: ['proof', 'terms'] }, selection: { anyOf: [uuid, { type: 'string', enum: ['source'] }] }, included: { type: 'boolean' } }, ['workspace', 'revision', 'actor', 'kind', 'selection']],
  ['merchant_accounting_recovered_source', 'Connect a declared recovered collection alias, or pass source:null to disconnect it. Existing completed reconciliation snapshots and their exact response files remain retained.', { ...change, source: { anyOf: [alias, { type: 'null' }] } }, ['workspace', 'revision', 'actor', 'source']],
  ['merchant_accounting_recovered_refresh', 'Read the connected original recovered collection into the workspace using its current revision. Does not verify remotely or make a payment.', change, ['workspace', 'revision', 'actor']],
  ['merchant_accounting_recovery_review', 'Review a declared original recovery request and retain its exact input hashes and native receipt binding. Reads original files without RPC, signing or payment; returns the previewId required for import.', { ...change, source: alias, name }, ['workspace', 'revision', 'actor', 'source', 'name']],
  ['merchant_accounting_recovery_import', 'Queue the original recovery importer for a retained previewId. It rechecks reviewed input hashes, reuses an identical existing entry, or calls the original official RPC verifier and imports that completed transfer. Follow the original job through status; never purchases the resource again.', { ...change, previewId: uuid }, ['workspace', 'revision', 'actor', 'previewId'], { openWorld: true }],
  ['merchant_accounting_recovery_cancel', 'Request cancellation of one original recovery job. Read its retained status afterward; an already completed import remains available. Does not cancel, send or reverse a ledger transaction.', { ...base, jobId: uuid, actor }, ['workspace', 'jobId', 'actor'], { idempotent: true }],
  ['merchant_accounting_capture', 'Capture current original outbox, selected terms/proofs, pricing provenance, recorded-activity period and recovered sources into an immutable named reconciliation. expectedPeriodSelection can pin the reviewed saved period or null. Follow the returned runId with run/status.', { ...change, name, expectedPeriodSelection: periodSelection }, ['workspace', 'revision', 'actor', 'name']],
  ['merchant_accounting_run', 'Inspect a retained original reconciliation status, exact report/input manifest digests, totals and review counts. Use rows for detailed tables and file for verified original report bytes.', { ...base, runId: uuid }, ['workspace', 'runId'], readOnly],
  ['merchant_accounting_rows', 'Page original ledger, payment options, exceptions, proof metadata or recovered entries from a completed reconciliation. Filters preserve the original six HTTP methods, networks and transfer/delivery classifications.', { ...base, runId: uuid, kind: { type: 'string', enum: ['ledger', 'options', 'exceptions', 'proofs', 'recovered'] }, ...page, routeId: { type: 'string', maxLength: 240 }, method: { type: 'string', enum: supportedMethods }, network: { type: 'string', maxLength: 240 }, transfer: { type: 'string', maxLength: 240 }, delivery: { type: 'string', maxLength: 240 }, review: { type: 'string', enum: ['open', 'investigating', 'reviewed'] }, search: { type: 'string', maxLength: 300 } }, ['workspace', 'runId', 'kind'], readOnly],
  ['merchant_accounting_review', 'Retain a named review of an actual original exception using its current note version. Notes and assignments do not change native settlement classifications.', { ...base, runId: uuid, exceptionId: sha256, version: { type: 'integer', minimum: 0 }, status: { type: 'string', enum: ['open', 'investigating', 'reviewed'] }, note: { type: 'string', minLength: 1, maxLength: 4000 }, assignee: { type: 'string', maxLength: 160 }, actor }, ['workspace', 'runId', 'exceptionId', 'version', 'status', 'note', 'actor']],
  ['merchant_accounting_compare', 'Compare two retained original reconciliations, with event, exception and option deltas. Page changed, added, removed or option rows without reclassifying or contacting a merchant.', { ...base, runId: uuid, baselineId: uuid, view: { type: 'string', enum: ['changed', 'added', 'removed', 'options'] }, ...page }, ['workspace', 'runId', 'baselineId'], readOnly],
  ['merchant_accounting_export', 'Create the original retained review TAR from a completed run and current named notes. Explicit includeSources:true includes the captured private original input files and retained delivered responses; false includes the report, review notes and source identities.', { ...change, runId: uuid, includeSources: { type: 'boolean' } }, ['workspace', 'revision', 'actor', 'runId', 'includeSources']],
  ['merchant_accounting_file', 'Read exact original response, report, export, collection result, pricing source, period close or accountant packet bytes in bounded base64 chunks. Keep every source selector unchanged with readId/expectedSha256. The original owner verifies once per read; later chunks reuse its private snapshot. See the accounting guide for each kind and filename.', { ...base, kind: { type: 'string', enum: ['response', 'report', 'export', 'collection', 'pricing', 'period', 'accountant'] }, recoveryId: sha256, runId: uuid, exportId: uuid, collectionId: uuid, sourceId: uuid, reviewId: uuid, closeId: uuid, handoffId: uuid, revisionId: returnSelection, file: { type: 'string', enum: [...new Set([...reportNames, ...periodNames, ...accountantNames, 'report', 'terms', 'archive'])] }, readId: uuid, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 196608 }, expectedSha256: sha256 }, ['workspace', 'kind'], readOnly],
  ['merchant_accounting_file_release', 'Release an unfinished process-owned file read by readId. Frees only its temporary verified snapshot; original recovered responses, reports, archives and workspace records remain retained.', { ...base, readId: uuid }, ['workspace', 'readId'], { idempotent: true }],
  ['merchant_accounting_collection_source', 'Retain one host-declared original SF81 payment record or SF82 evidence input with its configured payer, network endpoint and event-page limit. The original controller checks the source; no RPC or payment runs during import.', { ...change, source: alias, name }, ['workspace', 'revision', 'actor', 'source', 'name']],
  ['merchant_accounting_collection_prepare', 'Prepare an original RPC collection from explicit distinct retained sourceIds. Retains the original plan and source hashes; no verification runs until collection_start.', { ...change, name, sourceIds }, ['workspace', 'revision', 'actor', 'name', 'sourceIds']],
  ['merchant_accounting_collection', 'Inspect one original collection and its actual progress. Page selected sources, result attempts, published proof identities or owned operation jobs. This reads retained state and does not start or retry verification.', { ...base, collectionId: uuid, view: { type: 'string', enum: ['summary', 'sources', 'results', 'proofs', 'jobs'] }, ...page }, ['workspace', 'collectionId'], readOnly],
  ['merchant_accounting_collection_refresh', 'Refresh one inactive collection from its original durable result files and retain its totals with the current workspace revision. Does not call an RPC service.', { ...change, collectionId: uuid }, ['workspace', 'revision', 'actor', 'collectionId']],
  ['merchant_accounting_collection_start', 'Queue original collect or publish. Collect verifies unattempted records, or only the explicitly supplied unsuccessful retryIds; it never sends a payment. Publish imports existing exact result bytes into the same proof workspace. Follow original collectionJobs status.', { ...change, collectionId: uuid, operation: { type: 'string', enum: ['collect', 'publish'] }, retryIds: { ...sourceIds, minItems: 0 } }, ['workspace', 'revision', 'actor', 'collectionId', 'operation'], { openWorld: true }],
  ['merchant_accounting_collection_cancel', 'Cancel an owned original collection operation by jobId. Retains completed attempts and proof imports; later continuation is explicit.', { ...base, jobId: uuid, actor }, ['workspace', 'jobId', 'actor'], { idempotent: true }],
  ['merchant_accounting_pricing_review', 'Import a declared original pricing-report file into the existing pricing controller. Retains its exact source, derived accounting terms and provenance; selection is a separate operation.', { ...change, source: alias, name: { ...name, maxLength: 130 }, accountingReference: { type: 'string', maxLength: 100 } }, ['workspace', 'revision', 'actor', 'source', 'name']],
  ['merchant_accounting_pricing', 'Inspect a retained pricing review and page its original payment options. With baselineSelection, compare against original source terms or a retained terms ID. Does not select prices or calculate an exchange rate.', { ...base, reviewId: uuid, baselineSelection: { anyOf: [uuid, { type: 'string', enum: ['source'] }] }, ...page }, ['workspace', 'reviewId'], readOnly],
  ['merchant_accounting_pricing_select', 'Select the checked original pricing review for future captures. Uses the existing terms selector and current revision; prior captured reports keep their original prices and provenance.', { ...change, reviewId: uuid }, ['workspace', 'revision', 'actor', 'reviewId']],
  ['merchant_accounting_period_save', 'Save a named immutable recorded-activity UTC interval. To edit an existing definition, supply its id and current expectedVersion; select:true selects the saved version for future captures.', { ...change, id: uuid, expectedVersion: revision, name, from: timestamp, until: timestamp, note: { type: 'string', maxLength: 2000 }, select: { type: 'boolean' } }, ['workspace', 'revision', 'actor', 'name', 'from', 'until']],
  ['merchant_accounting_period_select', 'Select an exact retained period {id,version}, or null for all recorded activity. Original capture and recovery import times remain the period basis.', { ...change, selection: periodSelection }, ['workspace', 'revision', 'actor', 'selection']],
  ['merchant_accounting_period_definition', 'Inspect a saved recorded-activity definition and page its immutable versions before selecting or editing it. Status view:periods lists the retained definition IDs and latest versions.', { ...base, id: uuid, ...page }, ['workspace', 'id'], readOnly],
  ['merchant_accounting_period_close', 'Retain an original named close from a completed run captured with a saved period. Freezes its report, source identities and current exception reviews; includeSources explicitly chooses the source-inclusive original archive.', { ...change, runId: uuid, name, note: { type: 'string', maxLength: 4000 }, includeSources: { type: 'boolean' } }, ['workspace', 'revision', 'actor', 'runId', 'name', 'includeSources']],
  ['merchant_accounting_period', 'Inspect an exact retained close, frozen and current review counts, and its previous close. Use view:notes to page original frozen notes beside current reviews. Download the original metadata or archive with file kind:period.', { ...base, closeId: uuid, view: { type: 'string', enum: ['summary', 'notes'] }, status: { type: 'string', enum: ['open', 'investigating', 'reviewed'] }, search: { type: 'string', maxLength: 300 }, ...page }, ['workspace', 'closeId'], readOnly],
  ['merchant_accounting_accountant_prepare', 'Inspect the original completed run or retained period close before preparing an accountant handoff. Returns exact source hashes, original totals and paged payment options for operator labels.', { ...base, runId: uuid, closeId: uuid, ...page }, ['workspace'], readOnly],
  ['merchant_accounting_accountant_create', 'Retain the original accountant packet from a reviewed run or period close. Supply a stable id for lost-reply recovery and optional labels for actual option IDs. Native amounts and classifications remain from the original report.', { ...change, id: uuid, runId: uuid, closeId: uuid, name, labels: { type: 'array', items: optionLabel, maxItems: 22200 } }, ['workspace', 'revision', 'actor', 'id', 'name']],
  ['merchant_accounting_accountant', 'Inspect an original handoff, selected return and source hashes. revisionId:initial selects its unchanged initial packet; omission selects its latest return. Page retained return revisions, exact file identities, issues or labels.', { ...base, handoffId: uuid, revisionId: returnSelection, view: { type: 'string', enum: ['summary', 'revisions', 'files', 'issues', 'labels'] }, ...page }, ['workspace', 'handoffId'], readOnly],
  ['merchant_accounting_accountant_rows', 'Page original handoff rows and their current or selected returned assignments. External status and book references stay separate from source payment evidence, amounts and merchant quotes.', { ...base, handoffId: uuid, revisionId: returnSelection, status: { type: 'string', enum: ['UNREVIEWED', 'REVIEWED', 'BOOKED', 'EXCLUDED'] }, search: { type: 'string', maxLength: 500 }, ...page }, ['workspace', 'handoffId'], readOnly],
  ['merchant_accounting_accountant_preview', 'Review a declared accountant-return CSV against an explicit current parent (null for the first return). Returns exact source hash, proposed return ID/time/integrity, summary and optional paged outcomes. Repeat id/createdAt to inspect more pages of the same proposed revision. No return is saved.', { ...base, handoffId: uuid, source: alias, expectedParentId: nullableId, actor, name, id: uuid, createdAt: timestamp, sourceSha256: sha256, view: { type: 'string', enum: ['summary', 'results', 'issues', 'assignments', 'missingRows'] }, ...page }, ['workspace', 'handoffId', 'source', 'expectedParentId', 'actor', 'name'], { readOnly: true }],
  ['merchant_accounting_accountant_apply', 'Save the explicitly reviewed original returned CSV. Carry preview ID, timestamp, workspace revision, parent, source SHA256 and preview integrity unchanged. The original controller preserves conflicts, inherited omissions and immutable prior returns; stable IDs recover lost replies.', { ...change, handoffId: uuid, source: alias, id: uuid, createdAt: timestamp, name, expectedParentId: nullableId, sourceSha256: sha256, previewSha256: sha256 }, ['workspace', 'revision', 'actor', 'handoffId', 'source', 'id', 'createdAt', 'name', 'expectedParentId', 'sourceSha256', 'previewSha256']],
];
const byName = new Map(definitions.map(([name, description, properties, required]) => [name, { properties, required }]));
export const accountingTools = tool => definitions.map(parts => tool(...parts));

function check(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(option => check(option, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= (schema.minimum ?? Number.MIN_SAFE_INTEGER) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER);
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Infinity) && value.every(item => check(schema.items, item)) && (!schema.uniqueItems || new Set(value.map(item => JSON.stringify(item))).size === value.length);
  if (schema.type === 'object') return plain(value) && (schema.required ?? []).every(key => Object.hasOwn(value, key)) && Object.entries(value).every(([key, item]) => Object.hasOwn(schema.properties, key) ? check(schema.properties[key], item) : schema.additionalProperties !== false);
  if (typeof value !== schema.type) return false;
  return schema.type !== 'string' || (value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern).test(value)));
}
function exact(value, allowed, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Supply the declared accounting fields, including every required field.');
}
function named(value) {
  if (!check(alias, value)) throw fail('ACCOUNTING_INVALID_ALIAS', 'Choose a declared alias using 1–64 lowercase letters, digits, underscores or hyphens.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Accounting host paths must be nonempty strings.');
  const path = resolve(base, value);
  if (path === '/') throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Select a private accounting directory or file.');
  return path;
}
function sourceMap(raw, base) {
  if (raw === undefined) return Object.create(null);
  if (!plain(raw) || Object.keys(raw).length > 64) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare up to 64 aliases in each accounting source map.');
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [named(key), hostPath(value, base)]));
}
function collectionInputMap(raw, base) {
  if (raw === undefined) return Object.create(null);
  if (!plain(raw) || Object.keys(raw).length > 64) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare up to 64 original collection input aliases.');
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => {
    named(key); exact(value, ['file', 'kind', 'payer', 'rpcEndpoint', 'maxEventPages'], ['file', 'kind', 'payer']);
    if (!['sf81-record', 'sf82-evidence'].includes(value.kind) || !check({ type: 'string', pattern: '^G[A-Z2-7]{55}$' }, value.payer))
      throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare each original collection kind and its Stellar payer account.');
    if (value.maxEventPages !== undefined && !check({ type: 'integer', minimum: 1, maximum: 100 }, value.maxEventPages))
      throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Use 1–100 event pages for a declared collection input.');
    if (value.rpcEndpoint !== undefined) {
      let endpoint; try { endpoint = new URL(value.rpcEndpoint); } catch {}
      if (typeof value.rpcEndpoint !== 'string' || value.rpcEndpoint.length > 2048 || !endpoint || !['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash)
        throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare an HTTP or HTTPS RPC endpoint without embedded credentials or a fragment. The original network profile checks it when the source is imported.');
    }
    return [key, { ...value, file: hostPath(value.file, base) }];
  }));
}
export function normalizeAccountingConfig(raw, base) {
  if (raw === undefined || raw === null) return null;
  exact(raw, ['workspaces'], ['workspaces']);
  if (!plain(raw.workspaces) || Object.keys(raw.workspaces).length > 16) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare up to 16 original accounting workspaces.');
  const workspaces = Object.create(null), directories = new Set();
  for (const [key, value] of Object.entries(raw.workspaces)) {
    named(key); exact(value, ['label', 'directory', 'outboxDir', 'proofDir', 'termsFile', ...sourceKinds, 'collectionInputs', 'collectionHttpsProxyEnv', 'bitwave'], ['directory', 'outboxDir', 'proofDir', 'termsFile']);
    if (value.label !== undefined && (!check(name, value.label) || !value.label.trim())) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Use a nonempty workspace label up to 160 characters.');
    const entry = { label: value.label ?? key };
    for (const field of ['directory', 'outboxDir', 'proofDir', 'termsFile']) entry[field] = hostPath(value[field], base);
    if (directories.has(entry.directory)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare each accounting workspace directory once.');
    directories.add(entry.directory);
    for (const field of sourceKinds) entry[field] = sourceMap(value[field], base);
    entry.collectionInputs = collectionInputMap(value.collectionInputs, base);
    entry.bitwave = normalizeBitwaveConfig(value.bitwave, base);
    if (value.collectionHttpsProxyEnv !== undefined) {
      if (!check({ type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,127}$' }, value.collectionHttpsProxyEnv)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Choose the environment-variable name containing the configured collection HTTPS proxy.');
      entry.collectionHttpsProxyEnv = value.collectionHttpsProxyEnv;
    }
    workspaces[key] = entry;
  }
  return { workspaces };
}
async function sourceBytes(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw fail('ACCOUNTING_SOURCE_INVALID', 'Choose an original regular source file within its documented size limit.');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw fail('ACCOUNTING_SOURCE_INVALID', 'The original source file grew beyond its limit.');
    return bytes;
  } finally { await handle.close(); }
}
export async function readAccountingConfig(path) {
  path = resolve(path);
  return normalizeAccountingConfig(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await sourceBytes(path, 1024 * 1024))), dirname(path));
}
const content = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const pageOf = (items, args, view) => { const offset = args.offset ?? 0, limit = args.limit ?? 25; return { view, total: items.length, offset, limit, items: items.slice(offset, offset + limit) }; };
const collectionBrief = value => { const { sourceIds, ...rest } = value; return { ...rest, sourceCount: sourceIds.length }; };
const collectionJobBrief = value => { const { baselineAttempts, retryIds, ...rest } = value; return { ...rest, retryCount: retryIds?.length ?? 0 }; };
const periodBrief = value => { const { versions, ...rest } = value; return { ...rest, versionCount: versions.length, latestVersion: versions.at(-1) ?? null }; };
const handoffBrief = value => { const { revisions, ...rest } = value; return { ...rest, returnCount: revisions.length, latestReturn: revisions.at(-1) ?? null }; };
function collectionResult(value, args = {}) {
  const { sources, collections, jobs, publishedProofs, summary, ...rest } = value;
  const result = { ...rest, ...(rest.collection ? { collection: collectionBrief(rest.collection) } : {}), ...(rest.job ? { job: collectionJobBrief(rest.job) } : {}) };
  if (summary) { const { jobs: results, ...metadata } = summary; result.summary = { ...metadata, resultCount: results.length }; }
  const view = args.view ?? 'summary';
  if (view !== 'summary') {
    const selected = new Set(value.collection.sourceIds);
    const items = { sources: sources.filter(row => selected.has(row.id)), results: summary.jobs, proofs: publishedProofs,
      jobs: jobs.filter(row => row.collectionId === value.collection.id).map(collectionJobBrief) }[view];
    result.page = pageOf(items, args, view);
  }
  return result;
}

export class MerchantAccounting {
  #config; #sessions = new Map(); #closing = false; #close; #substitutions;
  #files = new RetainedFileReads({ errorPrefix: 'ACCOUNTING' });
  constructor(config) {
    this.#config = config.accounting ?? { workspaces: {} };
    this.#substitutions = Object.entries(this.#config.workspaces).flatMap(([key, value]) => [
      ...['directory', 'outboxDir', 'proofDir', 'termsFile'].map(field => [value[field], 'accounting://' + key + '/' + field]),
      ...sourceKinds.flatMap(kind => Object.entries(value[kind] ?? {}).map(([alias, path]) => [path, 'accounting://' + key + '/' + kind + '/' + alias])),
      ...Object.entries(value.collectionInputs ?? {}).map(([alias, input]) => [input.file, 'accounting://' + key + '/collectionInputs/' + alias]),
      ...bitwavePathReferences(value.bitwave, key),
    ]).sort((a, b) => b[0].length - a[0].length);
  }
  get summary() { return { configured: Object.keys(this.#config.workspaces), owned: [...this.#sessions.keys()], closing: this.#closing,
    ...this.#files.summary }; }
  #definition(key) {
    named(key); const definition = this.#config.workspaces[key];
    if (!Object.hasOwn(this.#config.workspaces, key)) throw fail('ACCOUNTING_WORKSPACE_NOT_CONFIGURED', 'Choose a workspace from merchant_accounting_sources.');
    return definition;
  }
  #safe(value) {
    if (typeof value === 'string') {
      for (const [path, reference] of this.#substitutions) value = value.split(path).join(reference);
      return value;
    }
    if (Array.isArray(value)) return value.map(item => this.#safe(item));
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.#safe(item)]));
    return value;
  }
  #sources(key) {
    const value = this.#definition(key), session = this.#sessions.get(key);
    return { workspace: key, label: value.label, ownership: session ? session.closing ? 'CLOSING' : session.workspace ? 'OPEN' : 'OPENING' : 'CLOSED',
      ...Object.fromEntries(sourceKinds.map(kind => [kind, Object.keys(value[kind] ?? {})])), collectionInputs: Object.keys(value.collectionInputs ?? {}),
      bitwave: bitwaveSourceView(value.bitwave) };
  }
  #state(key, state) {
    const definition = this.#definition(key), retained = this.#sessions.get(key)?.workspace?.state;
    return { schema: state.schema, workspace: key, revision: state.revision, sources: this.#sources(key), termsSelection: state.termsSelection,
      recoveredSource: Object.entries(definition.recoveredSources).find(([, path]) => path === state.recovery.directory)?.[0] ?? null,
      recoveryCapturedAt: state.recovery.capturedAt,
      counts: { runs: state.runs.length, recoveryJobs: state.recoveryJobs.length, recovered: state.recovery.entries.length,
        recoveryPreviews: state.recoveryPreviews.length, proofs: state.proofs.length, terms: state.termsImports.length, exports: state.exports.length,
        collectionSources: retained?.collectionSources?.length ?? 0, collections: retained?.rpcCollections?.length ?? 0, collectionJobs: retained?.collectionJobs?.length ?? 0,
        pricingReviews: state.pricingImports?.length ?? 0, periods: state.periods?.definitions.length ?? 0, closes: state.periods?.closes.length ?? 0, handoffs: state.accountantHandoffs?.length ?? 0 },
      periodSelection: state.periods?.selection ?? null,
      latestRun: state.runs[0] ?? null, latestRecoveryJob: state.recoveryJobs[0] ?? null, reviewCounts: state.reviewCounts,
      fileReads: this.#files.status(key) };
  }
  #result(key, value) {
    if (value?.record?.revisions) value = { ...value, record: handoffBrief(value.record) };
    if (value?.definition?.versions) value = { ...value, definition: periodBrief(value.definition) };
    return this.#safe(value?.state ? { ...value, state: this.#state(key, value.state) } : value);
  }
  #source(key, kind, source) {
    const map = this.#definition(key)[kind] ?? {}; named(source);
    if (!Object.hasOwn(map, source)) throw fail('ACCOUNTING_SOURCE_NOT_CONFIGURED', 'Choose a declared ' + kind + ' alias from merchant_accounting_sources.');
    return map[source];
  }
  async #open(key) {
    this.#definition(key);
    const existing = this.#sessions.get(key);
    if (existing?.closing) throw fail('ACCOUNTING_CLOSING', 'This accounting workspace is closing.');
    if (existing) { await existing.opening; return this.#safe(this.#state(key, existing.workspace.view())); }
    const definition = this.#definition(key), record = { workspace: null, collection: null, accountant: null, bitwave: null, closing: false, calls: new Set() };
    this.#sessions.set(key, record);
    record.opening = (async () => {
      const { directory, outboxDir, proofDir, termsFile } = definition;
      const workspace = await openAccountingWorkspace({ directory, outboxDir, proofDir, termsFile });
      try {
        const recovered = workspace.view().sources.recoveredDir;
        if (recovered && !Object.values(definition.recoveredSources).includes(recovered))
          throw fail('ACCOUNTING_SOURCE_NOT_CONFIGURED', 'Declare the existing recovered collection in this workspace’s recoveredSources before reopening it through MCP.');
        record.collection = await openCollectionWorkspace(workspace, { httpsProxyEnv: definition.collectionHttpsProxyEnv });
        record.accountant = new AccountantWorkspace(workspace);
        if (definition.bitwave) {
          record.bitwave = new MerchantBitwave(workspace, record.accountant, definition.bitwave, { scope: key, files: this.#files });
          await record.bitwave.recover();
        }
        record.workspace = workspace;
      } catch (error) {
        try { await record.bitwave?.close(); }
        finally { try { await record.collection?.close(); } finally { await workspace.close(); record.workspace = null; } }
        throw error;
      }
    })();
    try { await record.opening; return this.#safe(this.#state(key, record.workspace.view())); }
    catch (error) { this.#sessions.delete(key); throw error; }
  }
  async #closeWorkspace(key) {
    this.#definition(key);
    const record = this.#sessions.get(key);
    if (!record) return { workspace: key, ownership: 'CLOSED' };
    if (!record.close) {
      record.closing = true;
      record.close = (async () => {
        try {
          await record.opening; await Promise.allSettled([...record.calls]);
          await this.#files.closeScope(key);
          try { await record.bitwave?.close(); }
          finally { try { await record.collection?.close(); } finally { await record.workspace?.close(); } }
        }
        finally { if (this.#sessions.get(key) === record) this.#sessions.delete(key); }
      })();
    }
    await record.close;
    return { workspace: key, ownership: 'CLOSED', retained: true };
  }
  #readKey(args) { return JSON.stringify([args.workspace, args.kind, ...fileSelections.map(key => args[key] ?? null)]); }
  async #originalFile(workspace, args) {
    const { kind, runId, recoveryId, exportId, collectionId, sourceId, reviewId, closeId, handoffId, revisionId, file } = args;
    const selectors = { response: ['recoveryId', 'runId'], report: ['runId', 'file'], export: ['exportId'], collection: ['collectionId', 'sourceId'],
      pricing: ['reviewId', 'runId', 'file'], period: ['closeId', 'file'], accountant: ['handoffId', 'revisionId', 'file'] }[kind];
    if (fileSelections.some(key => args[key] !== undefined && !selectors.includes(key))) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Use only the original source selectors for this file kind.');
    const session = this.#sessions.get(args.workspace);
    if (kind === 'response') {
      if (!recoveryId) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Response retrieval requires recoveryId and optionally a captured runId.');
      return workspace.recoveredResponse(recoveryId, runId);
    }
    if (kind === 'report') {
      if (!runId || !reportNames.includes(file)) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Report retrieval requires runId and an original report filename.');
      return workspace.download(runId, file);
    }
    if (kind === 'export') {
      if (!exportId) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Archive retrieval requires the retained exportId.');
      return workspace.archive(exportId);
    }
    if (kind === 'collection') {
      if (!collectionId || !sourceId) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Collection retrieval requires its collectionId and retained sourceId.');
      return session.collection.result(collectionId, sourceId);
    }
    if (kind === 'pricing') {
      if (Boolean(reviewId) === Boolean(runId) || !['report', 'terms'].includes(file)) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Pricing retrieval requires exactly one reviewId or runId, with file:report or terms.');
      return reviewId ? workspace.pricing.file(reviewId, file) : workspace.pricing.runFile(runId, file);
    }
    if (kind === 'period') {
      if (!closeId || ![...periodNames, 'archive'].includes(file)) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Period retrieval requires closeId and an original close filename or archive.');
      return file === 'archive' ? workspace.archive(workspace.periods.closeRow(closeId).exportId) : workspace.periods.file(closeId, file);
    }
    if (!handoffId || !accountantNames.includes(file)) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Accountant retrieval requires handoffId and its original packet filename.');
    return session.accountant.file(handoffId, file, { revisionId });
  }
  async #file(workspace, args) {
    const value = await this.#files.read({ scope: args.workspace, key: this.#readKey(args), kind: args.kind,
      directory: workspace.directory, load: () => this.#originalFile(workspace, args),
      readId: args.readId, offset: args.offset, limit: args.limit, expectedSha256: args.expectedSha256 });
    return { workspace: args.workspace, kind: args.kind,
      ...Object.fromEntries(fileSelections.filter(key => key !== 'file' && args[key] !== undefined).map(key => [key, args[key]])), ...value };
  }
  async #execute(operation, args, workspace) {
    const key = args.workspace, session = this.#sessions.get(key);
    if (operation.startsWith('merchant_accounting_bitwave_')) {
      if (!session.bitwave) throw fail('BITWAVE_NOT_CONFIGURED', 'Declare Bitwave organizations and optional native page sets in this accounting workspace’s host configuration.');
      return session.bitwave.call(operation, args);
    }
    switch (operation) {
      case 'merchant_accounting_status': {
        const state = workspace.view(), result = this.#state(key, state), view = args.view ?? 'summary';
        if (view === 'summary') return result;
        const collection = ['collectionSources', 'collections', 'collectionJobs'].includes(view) ? session.collection.view() : null;
        const lists = { runs: state.runs, jobs: state.recoveryJobs, recovered: state.recovery.entries, previews: state.recoveryPreviews, proofs: state.proofs, terms: state.termsImports, exports: state.exports, history: state.history,
          collectionSources: collection?.sources, collections: collection?.collections.map(collectionBrief), collectionJobs: collection?.jobs.map(collectionJobBrief),
          pricing: state.pricingImports ?? [], periods: (state.periods?.definitions ?? []).map(periodBrief), closes: state.periods?.closes ?? [], handoffs: (state.accountantHandoffs ?? []).map(handoffBrief) };
        return { ...result, page: { ...pageOf(lists[view], args, view), ...(view === 'history' ? { scope: 'ORIGINAL_LATEST_100' } : {}) } };
      }
      case 'merchant_accounting_input_import': {
        const proof = args.kind === 'proof', path = this.#source(key, proof ? 'proofFiles' : 'termsFiles', args.source);
        const input = { revision: args.revision, actor: args.actor, name: args.source + '.json', content: content(await sourceBytes(path, proof ? 80000 : 200000)) };
        return proof ? workspace.importProof(input) : workspace.importTerms(input);
      }
      case 'merchant_accounting_input_select':
        if (args.kind === 'proof') {
          if (args.selection === 'source' || args.included === undefined) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Proof selection requires its retained ID and included:true or false.');
          return { state: await workspace.selectProof(args.selection, args) };
        }
        if (args.included !== undefined) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Terms selection does not use included.');
        return { state: await workspace.selectTerms(args) };
      case 'merchant_accounting_recovered_source': return { state: await workspace.connectRecovered({ ...args, directory: args.source === null ? null : this.#source(key, 'recoveredSources', args.source) }) };
      case 'merchant_accounting_recovered_refresh': return { state: await workspace.refreshRecovered(args) };
      case 'merchant_accounting_recovery_review': return workspace.reviewRecovery({ ...args, content: content(await sourceBytes(this.#source(key, 'recoveryRequests', args.source), 200000)) });
      case 'merchant_accounting_recovery_import': return workspace.importRecovery(args);
      case 'merchant_accounting_recovery_cancel': return { state: await workspace.cancelRecovery(args.jobId, args) };
      case 'merchant_accounting_capture': return workspace.begin(args);
      case 'merchant_accounting_run': {
        const result = await workspace.run(args.runId);
        return { run: result.run, ...(result.totals ? { totals: result.totals, routeCount: result.routes.length, optionCount: result.options.length,
          ignoredProofCount: result.ignoredProofs.length, unmatchedOfficialProofCount: result.unmatchedOfficialProofCount, reviewCounts: result.reviewCounts } : {}) };
      }
      case 'merchant_accounting_rows': return workspace.rows(args.runId, args.kind, args);
      case 'merchant_accounting_review': return workspace.review(args.runId, args.exceptionId, args);
      case 'merchant_accounting_compare': return workspace.compare(args.runId, args.baselineId, args);
      case 'merchant_accounting_export': return workspace.exportRun(args.runId, args);
      case 'merchant_accounting_collection_source': {
        const input = this.#source(key, 'collectionInputs', args.source), { file, ...settings } = input;
        return collectionResult(await session.collection.source({ ...args, ...settings, content: content(await sourceBytes(file, 4_000_000)) }));
      }
      case 'merchant_accounting_collection_prepare': return collectionResult(await session.collection.prepare(args));
      case 'merchant_accounting_collection': return collectionResult(await session.collection.detail(args.collectionId), args);
      case 'merchant_accounting_collection_refresh': return collectionResult(await session.collection.refresh(args.collectionId, args));
      case 'merchant_accounting_collection_start':
        if (args.operation === 'publish' && args.retryIds?.length) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'retryIds selects unsuccessful collect operations; publish uses existing original results.');
        return collectionResult(await session.collection.start(args.collectionId, args.operation, args));
      case 'merchant_accounting_collection_cancel': return collectionResult(await session.collection.cancel(args.jobId, args));
      case 'merchant_accounting_pricing_review': return workspace.pricing.review({ ...args, reportBase64: (await sourceBytes(this.#source(key, 'pricingReports', args.source), MAX_PRICING_REPORT_BYTES)).toString('base64') });
      case 'merchant_accounting_pricing': {
        if (args.baselineSelection) {
          const { items, ...result } = await workspace.pricing.compare(args.reviewId, args.baselineSelection);
          return { ...result, page: pageOf(items, args, 'comparison') };
        }
        const { options, ...result } = await workspace.pricing.detail(args.reviewId);
        return { ...result, page: pageOf(options, args, 'options') };
      }
      case 'merchant_accounting_pricing_select': return { state: await workspace.pricing.select(args.reviewId, args) };
      case 'merchant_accounting_period_save': return workspace.periods.save(args);
      case 'merchant_accounting_period_select': return { state: await workspace.periods.select(args) };
      case 'merchant_accounting_period_definition': {
        const definition = workspace.periods.definition(args.id);
        return { definition: periodBrief(definition), selection: workspace.periods.view().selection, page: pageOf(definition.versions, args, 'versions') };
      }
      case 'merchant_accounting_period_close': return workspace.periods.retainClose(args);
      case 'merchant_accounting_period':
        if (args.view === 'notes') return { closeId: args.closeId, ...(await workspace.periods.notes(args.closeId, args)) };
        return workspace.periods.detail(args.closeId);
      case 'merchant_accounting_accountant_prepare': {
        if (!args.runId && !args.closeId) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Choose the original completed runId or retained closeId.');
        const { options, ...result } = await session.accountant.prepare(args);
        return { ...result, page: pageOf(options, args, 'options') };
      }
      case 'merchant_accounting_accountant_create':
        if (!args.runId && !args.closeId) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Choose the original completed runId or retained closeId.');
        return session.accountant.create(args);
      case 'merchant_accounting_accountant': {
        const { record, issues, labels, ...result } = await session.accountant.detail(args.handoffId, args), view = args.view ?? 'summary';
        if (view !== 'summary') {
          const selected = result.selectedRevision ? record.revisions.find(row => row.id === result.selectedRevision.id) : null;
          result.page = pageOf({ revisions: record.revisions, files: selected?.files ?? record.files, issues, labels }[view], args, view);
        }
        return { ...result, record, issueCount: issues.length, labelCount: labels.length };
      }
      case 'merchant_accounting_accountant_rows': return session.accountant.rows(args.handoffId, args);
      case 'merchant_accounting_accountant_preview':
      case 'merchant_accounting_accountant_apply': {
        const bytes = await sourceBytes(this.#source(key, 'accountantReturns', args.source), ACCOUNTANT_CSV_BYTES), sha256 = digest(bytes);
        if (args.sourceSha256 && args.sourceSha256 !== sha256) throw fail('ACCOUNTING_RETURN_FILE_CHANGED', 'The declared returned CSV differs from the original preview. Review its current exact bytes before applying it.');
        const value = { ...args, csvBase64: bytes.toString('base64') };
        if (operation === 'merchant_accounting_accountant_apply') return session.accountant.apply(args.handoffId, value);
        const preview = await session.accountant.preview(args.handoffId, value), { results, issues, assignments, missingRows, ...revision } = preview.revision;
        const result = { ...preview, revision, source: { alias: args.source, bytes: bytes.length, sha256 } }, view = args.view ?? 'summary';
        if (view !== 'summary') result.page = pageOf({ results, issues, assignments, missingRows }[view], args, view);
        return result;
      }
      case 'merchant_accounting_file': return this.#file(workspace, args);
      case 'merchant_accounting_file_release': {
        await this.#files.release(key, args.readId); return { workspace: key, readId: args.readId, released: true };
      }
      default: throw fail('ACCOUNTING_UNKNOWN_TOOL', 'Unknown merchant accounting operation.');
    }
  }
  async call(operation, args = {}) {
    const definition = byName.get(operation);
    if (!definition) throw fail('ACCOUNTING_UNKNOWN_TOOL', 'Unknown merchant accounting operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    for (const [key, value] of Object.entries(args)) if (!check(definition.properties[key], value)) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Check the declared accounting argument: ' + key + '.');
    if (this.#closing) throw fail('ACCOUNTING_CLOSING', 'Merchant accounting is closing.');
    try {
      if (operation === 'merchant_accounting_sources') return { workspaces: (args.workspace ? [args.workspace] : Object.keys(this.#config.workspaces)).map(key => this.#sources(key)) };
      this.#definition(args.workspace);
      if (operation === 'merchant_accounting_open') return await this.#open(args.workspace);
      if (operation === 'merchant_accounting_close') return await this.#closeWorkspace(args.workspace);
      const record = this.#sessions.get(args.workspace);
      if (operation === 'merchant_accounting_status' && !record) return this.#sources(args.workspace);
      if (!record?.workspace || record.closing) throw fail('ACCOUNTING_NOT_OPEN', 'Open the declared accounting workspace before operating on it.');
      const pending = this.#execute(operation, args, record.workspace);
      record.calls.add(pending);
      try { return this.#result(args.workspace, await pending); }
      finally { record.calls.delete(pending); }
    } catch (error) {
      const message = ['ENOENT', 'EACCES', 'ENOTDIR', 'EISDIR', 'ELOOP'].includes(error.code)
        ? 'An original configured accounting source is unavailable. Check its host-side file and permissions.'
        : this.#safe(String(error.message ?? error));
      throw fail(error.code ?? 'ACCOUNTING_ERROR', message);
    }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        const results = await Promise.allSettled([...this.#sessions.keys()].map(key => this.#closeWorkspace(key)));
        await this.#files.close();
        const rejected = results.find(result => result.status === 'rejected');
        if (rejected) throw rejected.reason;
      })();
    }
    return this.#close;
  }
}
