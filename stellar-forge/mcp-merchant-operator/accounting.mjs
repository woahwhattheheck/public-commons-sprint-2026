// MIT. Agent operations over the retained original merchant accounting workspace.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { openAccountingWorkspace } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/store.mjs';
import { supportsSellerMethod } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/http-methods.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
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
const views = ['runs', 'jobs', 'recovered', 'previews', 'proofs', 'terms', 'exports', 'history'];
const sourceKinds = ['recoveredSources', 'recoveryRequests', 'proofFiles', 'termsFiles'];
const reportNames = ['report.json', 'ledger.csv', 'options.csv', 'exceptions.csv', 'review.html', 'manifest.json'];
const supportedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(supportsSellerMethod);

const definitions = [
  ['merchant_accounting_sources', 'List host-configured accounting workspaces and named recovered collections, recovery requests, proof files and terms. Returns aliases and ownership without local paths or source bytes.', { workspace: alias }, [], readOnly],
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
  ['merchant_accounting_capture', 'Capture current original outbox, selected terms/proofs and connected recovered sources into an immutable named reconciliation. Queues the existing accounting engine and report writer; follow the returned runId with run/status.', { ...change, name }, ['workspace', 'revision', 'actor', 'name']],
  ['merchant_accounting_run', 'Inspect a retained original reconciliation status, exact report/input manifest digests, totals and review counts. Use rows for detailed tables and file for verified original report bytes.', { ...base, runId: uuid }, ['workspace', 'runId'], readOnly],
  ['merchant_accounting_rows', 'Page original ledger, payment options, exceptions, proof metadata or recovered entries from a completed reconciliation. Filters preserve the original six HTTP methods, networks and transfer/delivery classifications.', { ...base, runId: uuid, kind: { type: 'string', enum: ['ledger', 'options', 'exceptions', 'proofs', 'recovered'] }, ...page, routeId: { type: 'string', maxLength: 240 }, method: { type: 'string', enum: supportedMethods }, network: { type: 'string', maxLength: 240 }, transfer: { type: 'string', maxLength: 240 }, delivery: { type: 'string', maxLength: 240 }, review: { type: 'string', enum: ['open', 'investigating', 'reviewed'] }, search: { type: 'string', maxLength: 300 } }, ['workspace', 'runId', 'kind'], readOnly],
  ['merchant_accounting_review', 'Retain a named review of an actual original exception using its current note version. Notes and assignments do not change native settlement classifications.', { ...base, runId: uuid, exceptionId: sha256, version: { type: 'integer', minimum: 0 }, status: { type: 'string', enum: ['open', 'investigating', 'reviewed'] }, note: { type: 'string', minLength: 1, maxLength: 4000 }, assignee: { type: 'string', maxLength: 160 }, actor }, ['workspace', 'runId', 'exceptionId', 'version', 'status', 'note', 'actor']],
  ['merchant_accounting_compare', 'Compare two retained original reconciliations, with event, exception and option deltas. Page changed, added, removed or option rows without reclassifying or contacting a merchant.', { ...base, runId: uuid, baselineId: uuid, view: { type: 'string', enum: ['changed', 'added', 'removed', 'options'] }, ...page }, ['workspace', 'runId', 'baselineId'], readOnly],
  ['merchant_accounting_export', 'Create the original retained review TAR from a completed run and current named notes. Explicit includeSources:true includes the captured private original input files and retained delivered responses; false includes the report, review notes and source identities.', { ...change, runId: uuid, includeSources: { type: 'boolean' } }, ['workspace', 'revision', 'actor', 'runId', 'includeSources']],
  ['merchant_accounting_file', 'Read an original response, report or review TAR in bounded base64 chunks. Original verification creates one private read snapshot; later chunks reuse its readId and expectedSha256 without rereading the entire source. Response selects recoveryId/optional runId; report selects runId/file; export selects exportId. Completed, released, idle and closed sessions free their snapshot.', { ...base, kind: { type: 'string', enum: ['response', 'report', 'export'] }, recoveryId: sha256, runId: uuid, file: { type: 'string', enum: reportNames }, exportId: uuid, readId: uuid, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 196608 }, expectedSha256: sha256 }, ['workspace', 'kind'], readOnly],
  ['merchant_accounting_file_release', 'Release an unfinished process-owned file read by readId. Frees only its temporary verified snapshot; original recovered responses, reports, archives and workspace records remain retained.', { ...base, readId: uuid }, ['workspace', 'readId'], { idempotent: true }],
];
const byName = new Map(definitions.map(([name, description, properties, required]) => [name, { properties, required }]));
export const accountingTools = tool => definitions.map(parts => tool(...parts));

function check(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(option => check(option, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= (schema.minimum ?? Number.MIN_SAFE_INTEGER) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER);
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
export function normalizeAccountingConfig(raw, base) {
  if (raw === undefined || raw === null) return null;
  exact(raw, ['workspaces'], ['workspaces']);
  if (!plain(raw.workspaces) || Object.keys(raw.workspaces).length > 16) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare up to 16 original accounting workspaces.');
  const workspaces = Object.create(null), directories = new Set();
  for (const [key, value] of Object.entries(raw.workspaces)) {
    named(key); exact(value, ['label', 'directory', 'outboxDir', 'proofDir', 'termsFile', ...sourceKinds], ['directory', 'outboxDir', 'proofDir', 'termsFile']);
    if (value.label !== undefined && (!check(name, value.label) || !value.label.trim())) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Use a nonempty workspace label up to 160 characters.');
    const entry = { label: value.label ?? key };
    for (const field of ['directory', 'outboxDir', 'proofDir', 'termsFile']) entry[field] = hostPath(value[field], base);
    if (directories.has(entry.directory)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare each accounting workspace directory once.');
    directories.add(entry.directory);
    for (const field of sourceKinds) entry[field] = sourceMap(value[field], base);
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

export class MerchantAccounting {
  #config; #sessions = new Map(); #closing = false; #close; #substitutions;
  #reads = new RetainedFileReads({ errorPrefix: 'ACCOUNTING' });
  constructor(config) {
    this.#config = config.accounting ?? { workspaces: {} };
    this.#substitutions = Object.entries(this.#config.workspaces).flatMap(([key, value]) => [
      ...['directory', 'outboxDir', 'proofDir', 'termsFile'].map(field => [value[field], 'accounting://' + key + '/' + field]),
      ...sourceKinds.flatMap(kind => Object.entries(value[kind]).map(([alias, path]) => [path, 'accounting://' + key + '/' + kind + '/' + alias])),
    ]).sort((a, b) => b[0].length - a[0].length);
  }
  get summary() { return { configured: Object.keys(this.#config.workspaces), owned: [...this.#sessions.keys()], closing: this.#closing,
    ...this.#reads.summary }; }
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
      ...Object.fromEntries(sourceKinds.map(kind => [kind, Object.keys(value[kind])])) };
  }
  #state(key, state) {
    const definition = this.#definition(key);
    return { schema: state.schema, workspace: key, revision: state.revision, sources: this.#sources(key), termsSelection: state.termsSelection,
      recoveredSource: Object.entries(definition.recoveredSources).find(([, path]) => path === state.recovery.directory)?.[0] ?? null,
      recoveryCapturedAt: state.recovery.capturedAt,
      counts: { runs: state.runs.length, recoveryJobs: state.recoveryJobs.length, recovered: state.recovery.entries.length,
        recoveryPreviews: state.recoveryPreviews.length, proofs: state.proofs.length, terms: state.termsImports.length, exports: state.exports.length },
      latestRun: state.runs[0] ?? null, latestRecoveryJob: state.recoveryJobs[0] ?? null, reviewCounts: state.reviewCounts,
      fileReads: this.#reads.status(key) };
  }
  #result(key, value) { return this.#safe(value?.state ? { ...value, state: this.#state(key, value.state) } : value); }
  #source(key, kind, source) {
    const map = this.#definition(key)[kind]; named(source);
    if (!Object.hasOwn(map, source)) throw fail('ACCOUNTING_SOURCE_NOT_CONFIGURED', 'Choose a declared ' + kind + ' alias from merchant_accounting_sources.');
    return map[source];
  }
  async #open(key) {
    this.#definition(key);
    const existing = this.#sessions.get(key);
    if (existing?.closing) throw fail('ACCOUNTING_CLOSING', 'This accounting workspace is closing.');
    if (existing) { await existing.opening; return this.#safe(this.#state(key, existing.workspace.view())); }
    const definition = this.#definition(key), record = { workspace: null, closing: false, calls: new Set() };
    this.#sessions.set(key, record);
    record.opening = (async () => {
      const { directory, outboxDir, proofDir, termsFile } = definition;
      const workspace = await openAccountingWorkspace({ directory, outboxDir, proofDir, termsFile });
      record.workspace = workspace;
      const recovered = workspace.view().sources.recoveredDir;
      if (recovered && !Object.values(definition.recoveredSources).includes(recovered)) {
        await workspace.close(); record.workspace = null;
        throw fail('ACCOUNTING_SOURCE_NOT_CONFIGURED', 'Declare the existing recovered collection in this workspace’s recoveredSources before reopening it through MCP.');
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
          await this.#reads.closeScope(key);
          await record.workspace?.close();
        }
        finally { if (this.#sessions.get(key) === record) this.#sessions.delete(key); }
      })();
    }
    await record.close;
    return { workspace: key, ownership: 'CLOSED', retained: true };
  }
  #readKey(args) { return JSON.stringify([args.workspace, args.kind, args.runId ?? null, args.recoveryId ?? null, args.exportId ?? null, args.file ?? null]); }
  async #originalFile(workspace, args) {
    const { kind, runId, recoveryId, exportId, file } = args;
    let result;
    if (kind === 'response') {
      if (!recoveryId || exportId || file) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Response retrieval requires recoveryId and optionally a captured runId.');
      result = await workspace.recoveredResponse(recoveryId, runId);
    } else if (kind === 'report') {
      if (!runId || !file || recoveryId || exportId) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Report retrieval requires runId and an original report filename.');
      result = await workspace.download(runId, file);
    } else {
      if (!exportId || recoveryId || runId || file) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Archive retrieval requires the retained exportId.');
      result = await workspace.archive(exportId);
    }
    return result;
  }
  async #file(workspace, args) {
    const value = await this.#reads.read({ scope: args.workspace, key: this.#readKey(args), kind: args.kind,
      directory: workspace.directory, load: () => this.#originalFile(workspace, args),
      readId: args.readId, offset: args.offset, limit: args.limit, expectedSha256: args.expectedSha256 });
    return { workspace: args.workspace, kind: args.kind,
      ...(args.runId ? { runId: args.runId } : {}), ...(args.recoveryId ? { recoveryId: args.recoveryId } : {}),
      ...(args.exportId ? { exportId: args.exportId } : {}), ...value };
  }
  async #execute(operation, args, workspace) {
    const key = args.workspace;
    switch (operation) {
      case 'merchant_accounting_status': {
        const state = workspace.view(), result = this.#state(key, state), view = args.view ?? 'summary';
        if (view === 'summary') return result;
        const lists = { runs: state.runs, jobs: state.recoveryJobs, recovered: state.recovery.entries, previews: state.recoveryPreviews, proofs: state.proofs, terms: state.termsImports, exports: state.exports, history: state.history };
        const items = lists[view], offset = args.offset ?? 0, limit = args.limit ?? 25;
        return { ...result, page: { view, total: items.length, offset, limit, items: items.slice(offset, offset + limit), ...(view === 'history' ? { scope: 'ORIGINAL_LATEST_100' } : {}) } };
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
      case 'merchant_accounting_file': return this.#file(workspace, args);
      case 'merchant_accounting_file_release': {
        await this.#reads.release(key, args.readId); return { workspace: key, readId: args.readId, released: true };
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
        await this.#reads.close();
        const rejected = results.find(result => result.status === 'rejected');
        if (rejected) throw rejected.reason;
      })();
    }
    return this.#close;
  }
}
