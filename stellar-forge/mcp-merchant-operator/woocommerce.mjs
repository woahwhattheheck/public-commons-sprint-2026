import { woocommerceTools, definitions, base, read, page, orderId, alias, reviewId, sha256, uuid, amount, currency, kind, exported, FILE, HASH, UUID } from './catalog/woocommerce.mjs';
export { woocommerceTools } from './catalog/woocommerce.mjs';
// MIT. Native Woo merchant operations through the existing merchant MCP provider.
import { constants } from 'node:fs';
import { MerchantWooErp } from './woo-erp.mjs';
import { readWooErpInputDefinitions } from './woo-erp-artifacts.mjs';
import { open, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { compileOperator, createMerchantClient, reviewOrder, resumeReview, releaseOrder,
  inspectReview, listReviews, exportReview } from '../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/merchant-operator.mjs';
import { inspectRefunds, prepareRefund, applyRefund, recoverRefund, inspectRefund,
  listRefunds, exportRefund, selectRefundAdjustment } from '../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/refund-operator.mjs';
import { originalRecordFromEvidence } from '../../stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/cli.mjs';
import { ADJUSTMENT_EXPORT_SCHEMA } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/adjustments.mjs';
import { privateDirectory, readBytes, parseJson, exists, safeCode } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';

export const WOOCOMMERCE_CONNECTION_SCHEMA = 'stellar-forge.woocommerce-connection.v1';



const MAX_RECORD = 4 * 1024 * 1024, MAX_EXPORT = 32 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');














const schemas = new Map(definitions.map(([name, , properties, required]) => [name,
  { type: 'object', properties, required, additionalProperties: false }]));

function check(schema, value) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') return plain(value) && schema.required.every(key => Object.hasOwn(value, key)) &&
    Object.entries(value).every(([key, item]) => Object.hasOwn(schema.properties, key) && check(schema.properties[key], item));
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= (schema.minimum ?? 0) &&
    value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER);
  if (typeof value !== schema.type) return false;
  return schema.type !== 'string' || !schema.pattern || new RegExp(schema.pattern).test(value);
}
function assert(value, code, message) { if (!value) throw failure('WOO_MCP_' + code, message); }
function hostPath(value, baseDirectory) {
  assert(typeof value === 'string' && value.length > 0 && !/[\0\r\n]/.test(value), 'CONFIGURATION_ERROR', 'Use a host-selected original path.');
  return resolve(baseDirectory, value);
}
async function privateJson(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    assert(stat.isFile() && stat.size <= maximum &&
      (process.platform === 'win32' || !(stat.mode & 0o077)), 'CONFIGURATION_ERROR', 'Use a private regular configuration file within its size limit.');
    const bytes = await handle.readFile();
    assert(bytes.length <= maximum, 'CONFIGURATION_ERROR', 'Configuration exceeds its size limit.');
    return parseJson(bytes);
  } finally { await handle.close(); }
}
async function realDirectory(path, { create = false } = {}) {
  await privateDirectory(path, { create });
  assert(await realpath(path) === path, 'DIRECTORY_CHANGED', 'Use the original real directory without a symlinked parent.');
  return path;
}

/** Connection files contain host references; live credentials stay in the native client environment. */
export async function readWooCommerceConfiguration(path) {
  path = resolve(path);
  const raw = await privateJson(path, 1024 * 1024), baseDirectory = dirname(path);
  exact(raw, ['schema', 'stores'], ['schema', 'stores']);
  assert(raw.schema === WOOCOMMERCE_CONNECTION_SCHEMA && plain(raw.stores) &&
    Object.keys(raw.stores).length >= 1 && Object.keys(raw.stores).length <= 32,
    'CONFIGURATION_ERROR', 'Declare 1–32 original Woo stores.');
  const stores = Object.create(null), workspaces = new Set();
  for (const [name, entry] of Object.entries(raw.stores)) {
    identifier(name, 'Woo store alias');
    exact(entry, ['label', 'operator', 'records', 'adjustments', 'erpInputs'], ['operator']);
    const operatorPath = hostPath(entry.operator, baseDirectory);
    const operator = compileOperator(await privateJson(operatorPath, 65536));
    assert(!workspaces.has(operator.workspace), 'CONFIGURATION_ERROR', 'Use one alias per original Woo operator workspace.');
    workspaces.add(operator.workspace);
    const records = Object.create(null), adjustments = Object.create(null);
    assert(plain(entry.records ?? {}) && Object.keys(entry.records ?? {}).length <= 128 &&
      plain(entry.adjustments ?? {}) && Object.keys(entry.adjustments ?? {}).length <= 32,
      'CONFIGURATION_ERROR', 'Declare up to 128 original receipt aliases and 32 accounting export roots.');
    for (const [source, item] of Object.entries(entry.records ?? {})) {
      identifier(source, 'Native receipt alias');
      exact(item, ['label', 'file', 'payer', 'rpcEndpoint', 'maxEventPages'], ['file', 'payer']);
      assert(typeof item.payer === 'string' && /^G[A-Z2-7]{55}$/.test(item.payer),
        'CONFIGURATION_ERROR', 'Declare the original trusted Stellar payer.');
      if (item.rpcEndpoint !== undefined) assert(typeof item.rpcEndpoint === 'string' && item.rpcEndpoint.length <= 2048,
        'CONFIGURATION_ERROR', 'RPC endpoints are host-configured original verifier inputs.');
      const maxEventPages = item.maxEventPages ?? 24;
      assert(Number.isSafeInteger(maxEventPages) && maxEventPages >= 1 && maxEventPages <= 100,
        'CONFIGURATION_ERROR', 'Use an original verifier page limit from 1 to 100.');
      records[source] = { label: line(item.label ?? source), file: hostPath(item.file, baseDirectory), payer: item.payer,
        ...(item.rpcEndpoint === undefined ? {} : { rpcEndpoint: item.rpcEndpoint }), maxEventPages };
    }
    for (const [source, item] of Object.entries(entry.adjustments ?? {})) {
      identifier(source, 'Accounting export alias');
      exact(item, ['label', 'directory'], ['directory']);
      adjustments[source] = { label: line(item.label ?? source), directory: hostPath(item.directory, baseDirectory) };
    }
    stores[name] = { label: line(entry.label ?? name), operator, records, adjustments,
      erpInputs: readWooErpInputDefinitions(entry.erpInputs, baseDirectory) };
  }
  return { stores };
}
function paged(rows, args) {
  const offset = args.offset ?? 0, limit = args.limit ?? 25, snapshotSha256 = digest(JSON.stringify(rows));
  assert(offset === 0 || args.expectedSnapshotSha256, 'PAGE_SNAPSHOT_REQUIRED', 'Repeat the first page snapshotSha256 when continuing.');
  assert(args.expectedSnapshotSha256 === undefined || args.expectedSnapshotSha256 === snapshotSha256,
    'PAGE_CHANGED', 'The original rows changed. Reopen their first page before continuing.');
  const selected = rows.slice(offset, offset + limit);
  return { snapshotSha256, offset, limit, total: rows.length,
    nextOffset: offset + selected.length < rows.length ? offset + selected.length : null, rows: selected };
}
function picked(value, keys) { return Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]])); }
function attemptView(value) {
  return { ...picked(value, ['attemptId', 'phase', 'status', 'startedAt', 'completedAt', 'observedAt',
    'reviewId', 'reviewSha256', 'adjustmentId', 'orderReference', 'error', 'readbackError']),
    ...(value.response ? { httpStatus: value.response.httpStatus, providerStatus: value.response.response?.status ?? null } : {}),
    ...(value.observation ? { observation: value.observation } : {}) };
}
function reviewView(value) {
  if (!value) return null;
  return { ...picked(value, ['schema', 'reviewId', 'siteUrl', 'orderReference', 'sourceSha256', 'createdAt', 'sha256', 'binding', 'releasable']),
    chain: picked(value.chain, ['schema', 'verdict', 'network', 'transaction', 'asset', 'recipient', 'payer',
      'atomicAmount', 'ledger', 'matchingTransfers', 'matchingEventId', 'rpcEndpoint', 'reason', 'error']) };
}
function refundView(value, args = {}) {
  return { ...picked(value, ['schema', 'adjustmentId', 'siteUrl', 'orderReference', 'status', 'input']),
    reviews: value.reviews?.map(item => picked(item, ['schema', 'adjustmentId', 'inputSha256', 'reviewSha256', 'observedAt', 'sha256'])),
    attempts: paged((value.attempts ?? []).map(attemptView), args) };
}
function refundOrderView(value, args = {}) {
  const view = args.view ?? 'adjustments';
  return { ...picked(value, ['schema', 'siteUrl', 'orderReference', 'identitySha256', 'revision', 'observedAt', 'originalPayment', 'order']),
    view, refundCount: value.refunds.length, adjustmentCount: value.adjustments.length, ...paged(value[view], args) };
}
function refundOutcome(value) {
  return { ...attemptView(value), ...picked(value, ['schema', 'inputSha256', 'sha256', 'adjustment', 'refund']),
    order: value.order ? refundOrderView(value.order) : null };
}
function adjustmentView(record) {
  return picked(record, ['schema', 'id', 'eventId', 'kind', 'status', 'amountAtomic', 'effectiveAt',
    'reason', 'reference', 'requestSha256', 'createdAt', 'original', 'refundTerms']);
}

/** Stateless original operations plus process-owned verified file snapshots. */
export class MerchantWooCommerce {
  #config; #stores; #files; #closing = false; #close; #pending = new Set();
  #environment; #fetchImpl; #erp;
  constructor(config, { environment = process.env, fetchImpl } = {}) {
    assert(environment && typeof environment === 'object' && !Array.isArray(environment) &&
      (fetchImpl === undefined || typeof fetchImpl === 'function'),
      'HOST_TRANSPORT_INVALID', 'Supply the merchant host environment and an optional trusted transport function.');
    this.#config = config; this.#stores = config.woocommerce?.stores ?? {};
    this.#environment = environment; this.#fetchImpl = fetchImpl;
    this.#files = new RetainedFileReads({ errorPrefix: 'WOO_MCP' });
    this.#erp = new MerchantWooErp(config, { environment, fetchImpl });
  }
  #client(config) {
    // Reopening a completed review retains its original offline behavior.
    // Resolve the native client and credentials only at its first live call.
    let client;
    return Object.fromEntries(['consoleStatus', 'orders', 'inspect', 'release',
      'inspectRefunds', 'prepareRefund', 'applyRefund'].map(name => [name, (...args) =>
      (client ??= createMerchantClient(config,
        { env: this.#environment, fetchImpl: this.#fetchImpl }))[name](...args)]));
  }
  get summary() { return { configured: Object.keys(this.#stores).length > 0, stores: Object.keys(this.#stores).length,
    pendingOperations: this.#pending.size, ...this.#files.summary, erp: this.#erp.summary }; }
  #store(name) {
    const store = this.#stores[name];
    assert(store, 'STORE_NOT_FOUND', 'Choose a host-declared Woo store alias.');
    return store;
  }
  #source(store, name) {
    const source = store.records[name];
    assert(source, 'SOURCE_NOT_FOUND', 'Choose a declared original native receipt.');
    return source;
  }
  async #adjustmentSource(store, name, exportId) {
    const source = store.adjustments[name];
    assert(source, 'SOURCE_NOT_FOUND', 'Choose a declared original accounting export root.');
    await realDirectory(source.directory);
    const directory = await realDirectory(join(source.directory, exportId));
    const path = join(directory, 'adjustments.json'), bytes = await readBytes(path, MAX_EXPORT);
    const value = parseJson(bytes);
    assert(value?.schema === ADJUSTMENT_EXPORT_SCHEMA && Array.isArray(value.events) &&
      value.events.every(event => plain(event) && Array.isArray(event.adjustments) && event.adjustments.every(plain)),
      'ADJUSTMENT_EXPORT_INVALID', 'Use the original canonical merchant adjustment export.');
    return { path, bytes, value, sourceSha256: digest(bytes) };
  }
  async #exportDirectory(args, create = false) {
    const segments = ['woocommerce', args.store, args.kind, args.id, args.exportId];
    let directory = await realDirectory(this.#config.exportsDirectory);
    for (const segment of segments) directory = await realDirectory(join(directory, segment), { create });
    return directory;
  }
  async #manifest(args, verifyFiles = false) {
    const store = this.#store(args.store), directory = await this.#exportDirectory(args);
    const bytes = await readBytes(join(directory, 'manifest.json'), MAX_RECORD), manifest = parseJson(bytes);
    const expectedSchema = args.kind === 'review' ? 'stellar-forge.sf104.merchant-review-export.v1' : 'stellar-forge.sf104.merchant-refund-export.v1';
    assert(manifest?.schema === expectedSchema && manifest.siteUrl === store.operator.siteUrl &&
      manifest[args.kind === 'review' ? 'reviewId' : 'adjustmentId'] === args.id && Array.isArray(manifest.files),
      'EXPORT_IDENTITY_CHANGED', 'The retained export differs from this store and original operation.');
    const names = new Set();
    for (const file of manifest.files) {
      assert(FILE.test(file?.name) && file.name !== 'manifest.json' && !names.has(file.name) &&
        Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MAX_EXPORT && HASH.test(file.sha256),
        'EXPORT_MANIFEST_INVALID', 'Use original unique export file identities within the retained source limit.');
      names.add(file.name);
      if (verifyFiles) {
        const original = await readBytes(join(directory, file.name), MAX_EXPORT);
        assert(original.length === file.bytes && digest(original) === file.sha256,
          'EXPORT_INCOMPLETE', 'An original export file is missing or differs from its saved manifest.');
      }
    }
    return { directory, bytes, manifest, manifestSha256: digest(bytes) };
  }
  async #execute(name, args) {
    if (name === 'merchant_woo_stores') {
      const entries = args.store === undefined ? Object.entries(this.#stores) : [[args.store, this.#store(args.store)]];
      return { schema: WOOCOMMERCE_CONNECTION_SCHEMA, ...this.summary,
        entries: entries.map(([alias, store]) => ({ alias, label: store.label, siteUrl: store.operator.siteUrl,
          receipts: Object.entries(store.records).map(([source, item]) => ({ source, label: item.label, payer: item.payer })),
          accountingExports: Object.entries(store.adjustments).map(([source, item]) => ({ source, label: item.label })),
          erpInputs: Object.entries(store.erpInputs ?? {}).map(([input, item]) => ({ input, label: item.label, kind: item.kind })),
          fileReads: this.#files.status(alias) })) };
    }
    const store = this.#store(args.store), config = store.operator;
    if (await exists(config.workspace)) await realDirectory(config.workspace);
    switch (name) {
      case 'merchant_woo_store_status': return this.#client(config).consoleStatus();
      case 'merchant_woo_queue': {
        const { store: _store, ...selection } = args;
        return this.#client(config).orders(selection);
      }
      case 'merchant_woo_order': return this.#client(config).inspect(args.order);
      case 'merchant_woo_review_source': {
        const source = this.#source(store, args.source), bytes = await readBytes(source.file, MAX_RECORD);
        const parsed = parseJson(bytes), record = parsed?.schema === 'scf82.checkout-evidence.v1' ? originalRecordFromEvidence(parsed) : parsed;
        assert(plain(record), 'SOURCE_INVALID', 'Use the original native receipt or checkout evidence.');
        return { store: args.store, source: args.source, label: source.label, payer: source.payer,
          recordSha256: digest(bytes), bytes: bytes.length, schema: record.schema ?? null,
          requirement: picked(record.requirement, ['scheme', 'network', 'amount', 'asset', 'payTo']),
          receipt: picked(record.receipt, ['success', 'transaction', 'network']), maxEventPages: source.maxEventPages };
      }
      case 'merchant_woo_review': {
        const source = this.#source(store, args.source);
        return reviewView(await reviewOrder(config, { id: args.reviewId, order: args.order, recordPath: source.file,
          payer: source.payer, rpcEndpoint: source.rpcEndpoint, maxEventPages: source.maxEventPages,
          expectedRecordSha256: args.expectedRecordSha256, client: this.#client(config) }));
      }
      case 'merchant_woo_review_resume': return reviewView(await resumeReview(config, args.reviewId, { client: this.#client(config) }));
      case 'merchant_woo_review_status': {
        const status = await inspectReview(config, args.reviewId, { live: args.live === true,
          ...(args.live === true ? { client: this.#client(config) } : {}) });
        return { ...picked(status, ['schema', 'reviewId', 'siteUrl', 'orderReference', 'status', 'order']),
          input: { ...picked(status.input, ['schema', 'reviewId', 'siteUrl', 'orderReference', 'payer', 'createdAt', 'binding', 'rpcEndpoint', 'maxEventPages']),
            sourceSha256: status.input.source.sha256, nativeRecordSha256: status.input.source.nativeRecordSha256 },
          review: reviewView(status.review), attempts: paged(status.attempts.map(attemptView), args) };
      }
      case 'merchant_woo_release': return releaseOrder(config, args.reviewId, {
        confirmOrder: args.confirmOrder, expectedReviewSha256: args.expectedReviewSha256, client: this.#client(config) });
      case 'merchant_woo_refunds': return refundOrderView(await inspectRefunds(config, args.order, { client: this.#client(config) }), args);
      case 'merchant_woo_refund_source': {
        const source = await this.#adjustmentSource(store, args.source, args.exportId);
        if (args.adjustmentId) {
          const { record } = selectRefundAdjustment(source.value, args.adjustmentId);
          return { source: args.source, exportId: args.exportId, sourceSha256: source.sourceSha256, bytes: source.bytes.length,
            adjustment: adjustmentView(record), reviewedRefund: record.verification.proof };
        }
        const rows = source.value.events.flatMap(event => (event.adjustments ?? []).map(record =>
          ({ ...adjustmentView(record), exportEventId: event.original?.eventId ?? event.eventId ?? null })));
        return { schema: source.value.schema, source: args.source, exportId: args.exportId,
          sourceSha256: source.sourceSha256, bytes: source.bytes.length, ...paged(rows, args) };
      }
      case 'merchant_woo_refund_prepare': {
        const source = await this.#adjustmentSource(store, args.source, args.exportId);
        assert(source.sourceSha256 === args.expectedSourceSha256, 'SOURCE_CHANGED', 'Reopen this original accounting export before preparing it.');
        const outcome = await prepareRefund(config, { adjustmentId: args.adjustmentId, order: args.order,
          adjustmentsPath: source.path, wooAmount: args.wooAmount, expectedSourceSha256: args.expectedSourceSha256,
          expectedCurrency: args.currency, client: this.#client(config) });
        return refundOutcome(outcome);
      }
      case 'merchant_woo_refund_apply': {
        const outcome = await applyRefund(config, args.adjustmentId, { confirmOrder: args.confirmOrder,
          expectedReviewSha256: args.expectedReviewSha256, client: this.#client(config) });
        return refundOutcome(outcome);
      }
      case 'merchant_woo_refund_recover': {
        const outcome = await recoverRefund(config, args.adjustmentId, { client: this.#client(config) });
        return refundOutcome(outcome);
      }
      case 'merchant_woo_refund_status': return refundView(await inspectRefund(config, args.adjustmentId), args);
      case 'merchant_woo_history': {
        const rows = args.kind === 'refund' ? await listRefunds(config)
          : await exists(join(config.workspace, 'reviews')) ? await listReviews(config) : [];
        return { store: args.store, kind: args.kind, ...paged(rows, args) };
      }
      case 'merchant_woo_export': {
        const directory = await this.#exportDirectory(args, true);
        await (args.kind === 'review' ? exportReview : exportRefund)(config, args.id, directory);
        const result = await this.#manifest(args);
        return { store: args.store, kind: args.kind, id: args.id, exportId: args.exportId,
          manifestSha256: result.manifestSha256, manifest: result.manifest };
      }
      case 'merchant_woo_export_status': {
        const result = await this.#manifest(args, true);
        return { store: args.store, kind: args.kind, id: args.id, exportId: args.exportId,
          manifestSha256: result.manifestSha256, manifest: result.manifest };
      }
      case 'merchant_woo_file': {
        const result = await this.#manifest(args);
        assert(result.manifestSha256 === args.expectedManifestSha256, 'EXPORT_CHANGED', 'Reopen the exact retained export manifest.');
        const selected = args.file === 'manifest.json' ? { name: 'manifest.json', bytes: result.bytes.length, sha256: result.manifestSha256 }
          : result.manifest.files.find(file => file.name === args.file);
        assert(selected, 'FILE_NOT_FOUND', 'Select a file from the original manifest.');
        assert(args.expectedSha256 === undefined || args.expectedSha256 === selected.sha256,
          'FILE_CHANGED', 'The requested file digest differs from the original manifest.');
        assert(!(args.readId || args.offset > 0) || args.expectedSha256,
          'READ_DIGEST_REQUIRED', 'Repeat the exact file SHA256 when continuing or resuming a read.');
        return this.#files.read({ scope: args.store, key: [args.kind, args.id, args.exportId, result.manifestSha256, args.file].join(':'),
          kind: args.kind, directory: this.#config.exportsDirectory, readId: args.readId,
          expectedSha256: selected.sha256, offset: args.offset, limit: args.limit,
          load: async () => {
            const bytes = args.file === 'manifest.json' ? result.bytes : await readBytes(join(result.directory, args.file), MAX_EXPORT);
            assert(bytes.length === selected.bytes && digest(bytes) === selected.sha256,
              'FILE_CHANGED', 'The original retained file differs from its manifest.');
            return { name: args.file, bytes };
          } });
      }
      case 'merchant_woo_file_release': await this.#files.release(args.store, args.readId); return { released: args.readId };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown Woo merchant operation.');
    }
  }
  async call(name, args = {}) {
    assert(!this.#closing, 'CLOSING', 'Woo merchant operations are closing.');
    if (name.startsWith('merchant_woo_erp_')) return this.#erp.call(name, args);
    const schema = schemas.get(name);
    assert(schema && check(schema, args), 'INPUT_INVALID', 'Use the published Woo tool schema and original IDs.');
    if (args.kind === 'refund' && args.id !== undefined)
      assert(UUID.test(args.id), 'INPUT_INVALID', 'Refund exports use the original adjustment UUID.');
    const pending = this.#execute(name, args); this.#pending.add(pending);
    try { return await pending; }
    catch (error) {
      const code = safeCode(error.code, 'WOO_MCP_OPERATION_FAILED');
      throw failure(code, code);
    } finally { this.#pending.delete(pending); }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => { await Promise.allSettled([...this.#pending]);
        await Promise.all([this.#files.close(), this.#erp.close()]); })();
    }
    return this.#close;
  }
}
