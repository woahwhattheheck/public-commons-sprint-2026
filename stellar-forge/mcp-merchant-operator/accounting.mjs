import { accountingTools, definitions, base, page, readOnly, maintenanceChange, sha256, name, backupId, uuid, alias, views, change, actor, periodSelection, supportedMethods, returnSelection, nullableId, timestamp, reportNames, periodNames, accountantNames, sourceIds, revision, optionLabel, shortText } from './catalog/accounting.mjs';
export { accountingTools } from './catalog/accounting.mjs';
// MIT. Agent operations over the retained original merchant accounting workspace.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { merchantQuickBooksRecoverySources } from './accounting-quickbooks-oauth.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { MerchantCryptoworth, cryptoworthFileSelectors } from './accounting-cryptoworth.mjs';
import { MerchantRunbooks, runbookFileSelectors } from './accounting-runbooks.mjs';
import { MerchantPortfolio, portfolioFileSelectors } from './accounting-portfolio.mjs';
import { adjustmentDefinitions, MerchantAdjustments } from './accounting-adjustments.mjs';
import { statementDefinitions, statementFileNames, statementFileSelectors, MerchantCustomerStatements } from './accounting-statements.mjs';
import { platformDefinitions, platformFileNames, normalizePlatformConfig, platformSourceView, platformPathReferences, MerchantPlatforms } from './accounting-platforms.mjs';
import { bitwaveDefinitions, normalizeBitwaveConfig, bitwaveSourceView, bitwavePathReferences, MerchantBitwave } from './bitwave.mjs';
import { openAccountingWorkspace } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/store.mjs';
import { openAccountingMaintenance } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/recovery-controller.mjs';
import { openCollectionWorkspace } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/collection-workspace.mjs';
import { AccountantWorkspace, ACCOUNTANT_CSV_BYTES } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/accountant-workspace.mjs';
import { MAX_PRICING_REPORT_BYTES } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/pricing.mjs';
import { supportsSellerMethod } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/http-methods.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');




















const sourceKinds = ['recoveredSources', 'recoveryRequests', 'proofFiles', 'termsFiles', 'pricingReports', 'accountantReturns', 'buyerSources', 'platformInputs', 'statementUsageInputs', 'cryptoworthInputs', 'runbookInputs', 'portfolioInputs'];



const fileSelections = ['runId', 'recoveryId', 'exportId', 'collectionId', 'sourceId', 'reviewId', 'closeId', 'handoffId', 'revisionId', 'adjustmentId', 'jobId', 'planId', 'responseId', 'nativePost', 'attemptId', 'file', ...statementFileSelectors, ...cryptoworthFileSelectors, ...runbookFileSelectors, ...portfolioFileSelectors];



const byName = new Map(definitions.map(([name, description, properties, required]) => [name, { properties, required }]));


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
  const workspaces = Object.create(null), directories = new Set(), backupRoots = new Set();
  for (const [key, value] of Object.entries(raw.workspaces)) {
    named(key); exact(value, ['label', 'directory', 'outboxDir', 'proofDir', 'termsFile', ...sourceKinds, 'collectionInputs', 'collectionHttpsProxyEnv', 'adjustmentHttpsProxyEnv', 'bitwave', 'platforms', 'recovery', 'portfolioClients'], ['directory', 'outboxDir', 'proofDir', 'termsFile']);
    if (value.label !== undefined && (!check(name, value.label) || !value.label.trim())) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Use a nonempty workspace label up to 160 characters.');
    const entry = { label: value.label ?? key };
    for (const field of ['directory', 'outboxDir', 'proofDir', 'termsFile']) entry[field] = hostPath(value[field], base);
    if (directories.has(entry.directory)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare each accounting workspace directory once.');
    directories.add(entry.directory);
    for (const field of sourceKinds) entry[field] = sourceMap(value[field], base);
    entry.portfolioClients = Object.create(null);
    if (value.portfolioClients !== undefined) {
      if (!plain(value.portfolioClients) || Object.keys(value.portfolioClients).length > 15)
        throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare up to 15 existing client-workspace aliases for a portfolio.');
      const selected = new Set();
      for (const [client, target] of Object.entries(value.portfolioClients)) {
        named(client); named(target);
        if (target === key || selected.has(target))
          throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Each portfolio client must select a separate original workspace, distinct from its coordinator.');
        selected.add(target); entry.portfolioClients[client] = target;
      }
    }
    entry.collectionInputs = collectionInputMap(value.collectionInputs, base);
    entry.bitwave = normalizeBitwaveConfig(value.bitwave, base);
    entry.platforms = normalizePlatformConfig(value.platforms, base);
    if (value.recovery !== undefined) {
      exact(value.recovery, ['stateRoot', 'backupRoot', 'passEnv', 'startPaused'], ['stateRoot', 'backupRoot']);
      const recovery = value.recovery, passEnv = recovery.passEnv ?? 'STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE';
      if (!check({ type: 'string', pattern: '^[A-Z][A-Z0-9_]{4,63}$' }, passEnv) || (recovery.startPaused !== undefined && typeof recovery.startPaused !== 'boolean'))
        throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare the original recovery passphrase environment-variable name and a boolean startPaused setting.');
      entry.recovery = { stateRoot: hostPath(recovery.stateRoot, base), backupRoot: hostPath(recovery.backupRoot, base), passEnv, startPaused: recovery.startPaused ?? false };
      if (backupRoots.has(entry.recovery.backupRoot)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Declare a separate original recovery catalog for each accounting workspace.');
      backupRoots.add(entry.recovery.backupRoot);
    }
    if (value.collectionHttpsProxyEnv !== undefined) {
      if (!check({ type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,127}$' }, value.collectionHttpsProxyEnv)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Choose the environment-variable name containing the configured collection HTTPS proxy.');
      entry.collectionHttpsProxyEnv = value.collectionHttpsProxyEnv;
    }
    if (value.adjustmentHttpsProxyEnv !== undefined) {
      if (!check({ type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,127}$' }, value.adjustmentHttpsProxyEnv)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Choose the environment-variable name containing the configured original refund-read HTTPS proxy.');
      entry.adjustmentHttpsProxyEnv = value.adjustmentHttpsProxyEnv;
    }
    workspaces[key] = entry;
  }
  const visited = new Set(), visiting = new Set();
  function visit(key) {
    if (visiting.has(key)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Portfolio client aliases must not form a coordinator cycle.');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const target of Object.values(workspaces[key].portfolioClients)) {
      if (!Object.hasOwn(workspaces, target)) throw fail('ACCOUNTING_CONFIGURATION_ERROR', 'Every portfolio client must select an existing accounting.workspaces alias.');
      visit(target);
    }
    visiting.delete(key); visited.add(key);
  }
  for (const key of Object.keys(workspaces)) visit(key);
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
  #config; #sessions = new Map(); #closing = false; #close; #substitutions; #platformOptions;
  #files = new RetainedFileReads({ errorPrefix: 'ACCOUNTING' });
  constructor(config, { environment = process.env, quickbooksOAuth = {} } = {}) {
    this.#config = config.accounting ?? { workspaces: {} };
    this.#platformOptions = { environment: { ...environment }, quickbooksOAuth: { ...quickbooksOAuth } };
    this.#substitutions = Object.entries(this.#config.workspaces).flatMap(([key, value]) => [
      ...['directory', 'outboxDir', 'proofDir', 'termsFile'].map(field => [value[field], 'accounting://' + key + '/' + field]),
      ...sourceKinds.flatMap(kind => Object.entries(value[kind] ?? {}).map(([alias, path]) => [path, 'accounting://' + key + '/' + kind + '/' + alias])),
      ...Object.entries(value.collectionInputs ?? {}).map(([alias, input]) => [input.file, 'accounting://' + key + '/collectionInputs/' + alias]),
      ...bitwavePathReferences(value.bitwave, key),
      ...platformPathReferences(value.platforms, key),
      ...Object.entries(value.recovery ?? {}).filter(([field]) => ['stateRoot', 'backupRoot'].includes(field)).map(([field, path]) => [path, 'accounting://' + key + '/recovery/' + field]),
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
    const mode = session?.maintenance?.view().mode;
    return { workspace: key, label: value.label, ownership: session ? session.closing ? 'CLOSING' : mode && mode !== 'RUNNING' ? mode : session.workspace ? 'OPEN' : 'OPENING' : 'CLOSED',
      ...Object.fromEntries(sourceKinds.map(kind => [kind, Object.keys(value[kind] ?? {})])), collectionInputs: Object.keys(value.collectionInputs ?? {}),
      bitwave: bitwaveSourceView(value.bitwave),
      platforms: platformSourceView(value.platforms),
      portfolioClients: Object.keys(value.portfolioClients ?? {}),
      adjustments: { verification: 'ORIGINAL_NETWORK_RPC', httpsProxyConfigured: Boolean(value.adjustmentHttpsProxyEnv) },
      operatingRecovery: { configured: Boolean(value.recovery), startPaused: value.recovery?.startPaused ?? false, mode: mode ?? 'CLOSED' } };
  }
  #state(key, state) {
    const definition = this.#definition(key), retained = this.#sessions.get(key)?.workspace?.state;
    return { schema: state.schema, workspace: key, revision: state.revision, sources: this.#sources(key), termsSelection: state.termsSelection,
      recoveredSource: Object.entries(definition.recoveredSources).find(([, path]) => path === state.recovery.directory)?.[0] ?? null,
      recoveryCapturedAt: state.recovery.capturedAt,
      counts: { runs: state.runs.length, recoveryJobs: state.recoveryJobs.length, recovered: state.recovery.entries.length,
        recoveryPreviews: state.recoveryPreviews.length, proofs: state.proofs.length, terms: state.termsImports.length, exports: state.exports.length,
        collectionSources: retained?.collectionSources?.length ?? 0, collections: retained?.rpcCollections?.length ?? 0, collectionJobs: retained?.collectionJobs?.length ?? 0,
        pricingReviews: state.pricingImports?.length ?? 0, periods: state.periods?.definitions.length ?? 0, closes: state.periods?.closes.length ?? 0, handoffs: state.accountantHandoffs?.length ?? 0,
        adjustments: retained?.adjustments?.length ?? 0, adjustmentJobs: retained?.adjustmentJobs?.length ?? 0 },
      periodSelection: state.periods?.selection ?? null,
      latestRun: state.runs[0] ?? null, latestRecoveryJob: state.recoveryJobs[0] ?? null, reviewCounts: state.reviewCounts,
      fileReads: this.#files.status(key) };
  }
  #result(key, value, operation) {
    // These providers project host metadata themselves. Reviewed operator text
    // and hash-bound native requests must cross the wire without substitutions.
    if (operation === 'merchant_accounting_file' || operation.startsWith('merchant_accounting_cryptoworth_') || operation.startsWith('merchant_accounting_runbooks_') || operation.startsWith('merchant_accounting_portfolio_')) return value;
    if (value?.record?.revisions) value = { ...value, record: handoffBrief(value.record) };
    if (value?.definition?.versions) value = { ...value, definition: periodBrief(value.definition) };
    return this.#safe(value?.state ? { ...value, state: this.#state(key, value.state) } : value);
  }
  #source(key, kind, source) {
    const map = this.#definition(key)[kind] ?? {}; named(source);
    if (!Object.hasOwn(map, source)) throw fail('ACCOUNTING_SOURCE_NOT_CONFIGURED', 'Choose a declared ' + kind + ' alias from merchant_accounting_sources.');
    return map[source];
  }
  #maintenanceState(key, value, args = {}) {
    const { backups = [], jobs = [], review, ...state } = value;
    const roots = review?.roots ?? [], additionalSources = review?.additionalSources ?? [];
    const result = { ...state, workspaceAlias: key,
      review: review ? { ...review, roots: roots.slice(0, 25), additionalSources: additionalSources.slice(0, 25) } : null,
      backups: backups.slice(0, 25), jobs: jobs.slice(0, 10),
      counts: { backups: backups.length, retainedJobs: jobs.length, roots: roots.length, additionalSources: additionalSources.length } };
    const view = args.view ?? 'summary';
    if (view !== 'summary') {
      const sources = [...roots.map(item => ({ ...item, sourceType: 'root' })), ...additionalSources.map(item => ({ ...item, sourceType: 'additional' }))];
      result.page = pageOf({ backups, jobs, sources }[view], args, view);
      if (view === 'jobs') result.page.scope = 'ORIGINAL_LATEST_50';
    }
    return result;
  }
  #sessionState(key, record) {
    if (record.workspace) return this.#state(key, record.workspace.view());
    return { workspace: key, revision: null, sources: this.#sources(key),
      maintenance: this.#maintenanceState(key, record.maintenance.view()) };
  }
  async #maintenanceExecute(operation, args, record) {
    const maintenance = record.maintenance;
    if (operation === 'merchant_accounting_maintenance_status') return this.#maintenanceState(args.workspace, maintenance.view(), args);
    if (!maintenance.enabled) throw fail('ACCOUNTING_MAINTENANCE_NOT_CONFIGURED', 'The host must declare recovery state and backup roots before using operating recovery.');
    if (operation === 'merchant_accounting_maintenance_job') return { job: await maintenance.readJob(args.jobId), state: this.#maintenanceState(args.workspace, maintenance.view()) };
    const { workspace, jobId, ...value } = args;
    const result = await maintenance.command(operation.slice('merchant_accounting_maintenance_'.length), value, jobId);
    return { ...result, state: this.#maintenanceState(workspace, result.state) };
  }
  async #openRuntime(key, record) {
    const definition = this.#definition(key), { directory, outboxDir, proofDir, termsFile } = definition;
    const workspace = await openAccountingWorkspace({ directory, outboxDir, proofDir, termsFile });
    const runtime = { workspace, collection: null, accountant: null, bitwave: null, adjustments: null, statements: null, platforms: null, cryptoworth: null, runbooks: null, portfolio: null, clientWorkspaces: new Set() };
    try {
      const recovered = workspace.view().sources.recoveredDir;
      if (recovered && !Object.values(definition.recoveredSources).includes(recovered))
        throw fail('ACCOUNTING_SOURCE_NOT_CONFIGURED', 'Declare the existing recovered collection in this workspace’s recoveredSources before reopening it through MCP.');
      runtime.collection = await openCollectionWorkspace(workspace, { httpsProxyEnv: definition.collectionHttpsProxyEnv });
      runtime.accountant = new AccountantWorkspace(workspace);
      runtime.cryptoworth = new MerchantCryptoworth(workspace, runtime.accountant, { readSource: (source, maximum) => sourceBytes(this.#source(key, 'cryptoworthInputs', source), maximum) });
      runtime.runbooks = new MerchantRunbooks(workspace, runtime.accountant, { readSource: (source, maximum) => sourceBytes(this.#source(key, 'runbookInputs', source), maximum) });
      runtime.portfolio = new MerchantPortfolio(runtime.runbooks.controller, {
        clientAliases: Object.keys(definition.portfolioClients ?? {}),
        withClient: (client, fn) => this.#withPortfolioClient(key, runtime, client, fn),
        readSource: (source, maximum) => sourceBytes(this.#source(key, 'portfolioInputs', source), maximum),
      });
      runtime.adjustments = new MerchantAdjustments(workspace, { httpsProxyEnv: definition.adjustmentHttpsProxyEnv });
      runtime.statements = new MerchantCustomerStatements(workspace, { readSource: (source, maximum) => sourceBytes(this.#source(key, 'statementUsageInputs', source), maximum) });
      await runtime.statements.init();
      runtime.platforms = new MerchantPlatforms(workspace, runtime.accountant, { ...this.#platformOptions, definition: definition.platforms,
        readSource: (source, maximum) => sourceBytes(this.#source(key, 'platformInputs', source), maximum) });
      await runtime.platforms.init();
      if (definition.bitwave) {
        runtime.bitwave = new MerchantBitwave(workspace, runtime.accountant, definition.bitwave, { scope: key, files: this.#files });
        await runtime.bitwave.recover();
      }
      Object.assign(record, runtime); return runtime;
    } catch (error) { await this.#closeRuntime(key, record, runtime).catch(() => {}); throw error; }
  }
  async #withPortfolioClient(key, runtime, client, fn) {
    named(client);
    const targets = this.#definition(key).portfolioClients ?? {};
    if (!Object.hasOwn(targets, client) || typeof fn !== 'function')
      throw fail('ACCOUNTING_PORTFOLIO_CLIENT_NOT_CONFIGURED', 'Choose an original configured portfolio client alias.');
    const target = targets[client];
    await this.#open(target, { borrower: runtime });
    const record = this.#sessions.get(target);
    if (!record?.maintenance || record.closing)
      throw fail('ACCOUNTING_NOT_OPEN', 'The selected original client workspace is closing or unavailable.');
    const admission = record.maintenance.enter();
    const pending = Promise.resolve().then(() => fn({
      workspace: admission.workspace, accountant: admission.accountant, runbooks: admission.runbooks.controller,
    }));
    record.calls.add(pending);
    try { return await pending; }
    finally { record.calls.delete(pending); admission.release(); }
  }
  async #releasePortfolioClients(runtime) {
    for (const key of [...(runtime.clientWorkspaces ?? [])]) {
      const record = this.#sessions.get(key);
      if (!record || !record.borrowers.has(runtime)) { runtime.clientWorkspaces.delete(key); continue; }
      if (record.explicitOpened || record.borrowers.size > 1) {
        record.borrowers.delete(runtime); runtime.clientWorkspaces.delete(key); continue;
      }
      // Keep this final borrow until the original owner actually closes.
      await this.#closeWorkspace(key);
      record.borrowers.delete(runtime); runtime.clientWorkspaces.delete(key);
    }
  }
  async #closeRuntime(key, record, runtime) {
    // A client close failure retains the complete coordinator runtime for retry.
    await this.#releasePortfolioClients(runtime);
    let problem;
    try { await this.#files.closeScope(key); } catch (error) { problem = error; }
    for (const owner of [runtime.portfolio, runtime.runbooks, runtime.cryptoworth, runtime.platforms, runtime.bitwave, runtime.collection, runtime.workspace]) {
      if (!owner) continue;
      try { await owner.close(); } catch (error) { problem ??= error; }
      finally { if (owner.tasks) await Promise.allSettled([...owner.tasks]); }
    }
    if (problem) throw problem;
    if (record.workspace === runtime.workspace) Object.assign(record, { workspace: null, collection: null, accountant: null, bitwave: null, adjustments: null, statements: null, platforms: null, cryptoworth: null, runbooks: null, portfolio: null, clientWorkspaces: null });
  }
  async #open(key, { borrower } = {}) {
    this.#definition(key);
    const existing = this.#sessions.get(key);
    if (existing?.closing) throw fail('ACCOUNTING_CLOSING', 'This accounting workspace is closing.');
    if (existing) {
      await existing.opening;
      if (existing.closing) throw fail('ACCOUNTING_CLOSING', 'This accounting workspace is closing.');
      if (borrower) { existing.borrowers.add(borrower); borrower.clientWorkspaces.add(key); }
      else existing.explicitOpened = true;
      return this.#safe(this.#sessionState(key, existing));
    }
    const definition = this.#definition(key), record = { workspace: null, collection: null, accountant: null, bitwave: null, adjustments: null, statements: null, platforms: null, cryptoworth: null, runbooks: null, portfolio: null, clientWorkspaces: null, maintenance: null, closing: false, explicitOpened: !borrower, borrowers: new Set(), calls: new Set() };
    this.#sessions.set(key, record);
    record.opening = (async () => {
      const oauth = definition.platforms?.qbo?.oauth;
      const hostSources = oauth ? merchantQuickBooksRecoverySources(oauth, {
        environment: this.#platformOptions.environment, allowLoopback: this.#platformOptions.quickbooksOAuth.allowLoopback,
        onPaths: roots => {
          for (const root of roots) {
            if (!this.#substitutions.some(([path]) => path === root.path))
              this.#substitutions.push([root.path, 'accounting://' + key + '/recovery/host/' + root.name]);
          }
          this.#substitutions.sort((a,b) => b[0].length - a[0].length);
        },
      }) : undefined;
      record.maintenance = await openAccountingMaintenance({ directory: definition.directory, ...definition.recovery, hostSources,
        openRuntime: () => this.#openRuntime(key, record), closeRuntime: runtime => this.#closeRuntime(key, record, runtime) });
    })();
    try {
      await record.opening;
      if (borrower) { record.borrowers.add(borrower); borrower.clientWorkspaces.add(key); }
      return this.#safe(this.#sessionState(key, record));
    }
    catch (error) { this.#sessions.delete(key); throw error; }
  }
  async #closeWorkspace(key) {
    this.#definition(key);
    const record = this.#sessions.get(key);
    if (!record) return { workspace: key, ownership: 'CLOSED' };
    if (!record.close) {
      record.closing = true;
      const attempt = (async () => {
        await record.opening; await Promise.allSettled([...record.calls]);
        await record.maintenance?.close();
        if (this.#sessions.get(key) === record) this.#sessions.delete(key);
      })();
      record.close = attempt;
      attempt.catch(() => { if (record.close === attempt) record.close = null; });
    }
    await record.close;
    return { workspace: key, ownership: 'CLOSED', retained: true };
  }
  #readKey(args) { return JSON.stringify([args.workspace, args.kind, ...fileSelections.map(key => args[key] ?? null)]); }
  async #originalFile(workspace, args) {
    const { kind, runId, recoveryId, exportId, collectionId, sourceId, reviewId, closeId, handoffId, revisionId, adjustmentId, file } = args;
    const selectors = { response: ['recoveryId', 'runId'], report: ['runId', 'file'], export: ['exportId'], collection: ['collectionId', 'sourceId'],
      pricing: ['reviewId', 'runId', 'file'], period: ['closeId', 'file'], accountant: ['handoffId', 'revisionId', 'file'], adjustment: ['adjustmentId', 'jobId', 'file'], qbo: ['planId', 'responseId', 'nativePost', 'attemptId', 'file'], xero: ['planId', 'file'],
      'customer-statement': ['statementId', 'file'],
      cryptoworth: ['profileId', 'planId', 'captureId', 'returnId', 'rollbackId', 'scope', 'file'],
      runbooks: ['cycleId', 'fileId', 'file'],
      portfolio: ['captureId', 'receivedId', 'clientId', 'cycleId', 'planId', 'file'],
      'customer-statement-preview': ['customerId', 'runId', 'usageId', 'replacesId', 'from', 'until', 'file'] }[kind];
    if (fileSelections.some(key => args[key] !== undefined && !selectors.includes(key))) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Use only the original source selectors for this file kind.');
    const session = this.#sessions.get(args.workspace);
    if (kind === 'cryptoworth') return session.cryptoworth.file(args);
    if (kind === 'runbooks') return session.runbooks.file(args);
    if (kind === 'portfolio') return session.portfolio.file(args);
    if (kind === 'qbo' || kind === 'xero') return session.platforms.file(args);
    if (kind === 'customer-statement' || kind === 'customer-statement-preview') return session.statements.file(args);
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
    if (kind === 'adjustment') {
      if (!adjustmentId) throw fail('ACCOUNTING_INVALID_ARGUMENTS', 'Adjustment retrieval requires its original adjustmentId and request.json or proof.json with its jobId.');
      return session.adjustments.file(args);
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
    if (operation.startsWith('merchant_accounting_cryptoworth_')) return session.cryptoworth.call(operation, args);
    if (operation.startsWith('merchant_accounting_runbooks_')) return session.runbooks.call(operation, args);
    if (operation.startsWith('merchant_accounting_portfolio_')) return session.portfolio.call(operation, args);
    if (operation.startsWith('merchant_accounting_qbo_') || operation.startsWith('merchant_accounting_xero_')) return session.platforms.call(operation, args);
    if (operation.startsWith('merchant_accounting_customer_')) return session.statements.call(operation, args);
    if (operation === 'merchant_accounting_adjustment' || operation.startsWith('merchant_accounting_adjustment_'))
      return session.adjustments.call(operation, args);
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
      case 'merchant_accounting_accountant_buyer_prepare':
      case 'merchant_accounting_accountant_buyer_create': {
        const bytes=await sourceBytes(this.#source(key,'buyerSources',args.source),ACCOUNTANT_CSV_BYTES),sha256=digest(bytes);
        if(sha256!==args.sourceSha256)throw fail('ACCOUNTING_BUYER_SOURCE_CHANGED','The original issued buyer file differs from the reviewed SHA-256.');
        const buyerSource={contentBase64:bytes.toString('base64'),sha256};
        if(operation==='merchant_accounting_accountant_buyer_create')
          return session.accountant.create({id:args.id,name:args.name,actor:args.actor,revision:args.revision,buyerSource});
        return {...await session.accountant.prepareBuyer({buyerSource}),input:{alias:args.source,bytes:bytes.length,sha256}};
      }
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
      if (operation === 'merchant_accounting_status' && (!record || !record.workspace)) return this.#safe(record?.maintenance ? this.#sessionState(args.workspace, record) : this.#sources(args.workspace));
      if (!record?.maintenance || record.closing) throw fail('ACCOUNTING_NOT_OPEN', 'Open the declared accounting workspace before operating on it.');
      const operatingRecovery = operation.startsWith('merchant_accounting_maintenance_');
      const admission = operatingRecovery ? null : record.maintenance.enter();
      const pending = operatingRecovery ? this.#maintenanceExecute(operation, args, record) : this.#execute(operation, args, admission.workspace);
      record.calls.add(pending);
      try { return operatingRecovery ? this.#safe(await pending) : this.#result(args.workspace, await pending, operation); }
      finally { record.calls.delete(pending); admission?.release(); }
    } catch (error) {
      const message = ['ENOENT', 'EACCES', 'ENOTDIR', 'EISDIR', 'ELOOP'].includes(error.code)
        ? 'An original configured accounting source is unavailable. Check its host-side file and permissions.'
        : this.#safe(String(error.message ?? error));
      const exposed = fail(error.code ?? 'ACCOUNTING_ERROR', message);
      if (error.applied === false) exposed.applied = false;
      throw exposed;
    }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      const attempt = (async () => {
        // Accepted coordinator calls may still admit children. Drain them before
        // taking the final set of original owners to close.
        for (;;) {
          const records = [...this.#sessions.values()];
          await Promise.allSettled(records.flatMap(record => [record.opening, ...record.calls].filter(Boolean)));
          if ([...this.#sessions.values()].every(record => record.calls.size === 0)) break;
        }
        const results = await Promise.allSettled([...this.#sessions.keys()].map(key => this.#closeWorkspace(key)));
        const rejected = results.find(result => result.status === 'rejected');
        if (rejected) throw rejected.reason;
        await this.#files.close();
      })();
      this.#close = attempt;
      attempt.catch(() => { if (this.#close === attempt) this.#close = null; });
    }
    return this.#close;
  }
}
