// MIT. Original SF97 pricing decisions over the merchant's existing MCP transport.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { normalizeReleaseRuntime, readReleaseState } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';

export const PRICING_CONNECTION_SCHEMA = 'stellar-forge.pricing-workspace-connection.v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const revision = { anyOf: [digest, { type: 'null' }] };
const nullableText = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const usd = { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$' };
const optionalUsd = { anyOf: [usd, { type: 'null' }] };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const commercial = object({ merchantName: { type: 'string', minLength: 1, maxLength: 160 },
  sharedMonthlyFixedUsd: optionalUsd,
  routes: { type: 'object', properties: {}, additionalProperties: object({ unitPriceUsd: usd,
    priceBasis: { type: 'string', minLength: 4, maxLength: 300 }, perFulfilledUsd: optionalUsd,
    perChallengeUsd: optionalUsd, monthlyPaidTarget: { type: 'integer', minimum: 0 } }) } });
const selection = object({ kind: { type: 'string', enum: ['SESSION', 'DURABLE_HISTORY'] },
  from: nullableText, to: nullableText, routeId: nullableText }, ['kind']);
const edits = { type: 'array', minItems: 1, items: object({
  routeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' }, paymentIndex: { type: 'integer', minimum: 0 },
  expectedAmount: { type: 'string', pattern: '^[1-9][0-9]*$' }, amount: { type: 'string', pattern: '^[1-9][0-9]*$' } }) };
const base = { workspace: alias };
const priceInput = { ...base, sellerSha256: digest, snapshotSha256: digest, commercial };
const repriceInput = { ...base, version: uuid, sellerSha256: digest, edits };
const saveInput = { requestId: uuid, expectedRevision: revision, label: { type: 'string', minLength: 1, maxLength: 100 } };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };
const fileSelection = { ...base, kind: { type: 'string', enum: ['review', 'decision'] }, id: uuid };
const read = { readOnly: true, idempotent: true };
const sourceViews = ['routes', 'reviews', 'decisions', 'days', 'sessions', 'observations'];
const reportViews = ['routes', 'issues', 'historyDays', 'historySessions', 'historyRoutes', 'periodDays', 'periodVariants'];
const definitions = [
  ['merchant_pricing_status', 'List host-declared pricing workspaces and their process-local capture/file-read state. Does not capture operations or open a workspace.', { ...base }, [], read],
  ['merchant_pricing_open', 'Open the original SF97 workspace model and capture its configured native operations source. Reopening the same alias reuses its original captures. Original per-save compare-and-swap remains shared with the browser.', base, ['workspace'], { idempotent: true }],
  ['merchant_pricing_close', 'Release this MCP handle\'s source view and temporary file reads. Original saved reviews, price decisions and staged releases remain in their original stores.', base, ['workspace'], { idempotent: true }],
  ['merchant_pricing_source', 'Capture current seller terms and original session/history observations, or page the same capture with captureSha256. Route pages include every ordered payment option and its saved commercial inputs. Use the returned seller/snapshot hashes for preview and save.',
    { ...base, selection, captureSha256: digest, view: { type: 'string', enum: sourceViews }, ...page }, ['workspace'], read],
  ['merchant_pricing_preview', 'Evaluate merchant-entered USD prices, costs and targets against the original captured observations. Page original route economics, issues or retained history details. Atomic payment amounts remain the seller\'s declared values.',
    { ...priceInput, view: { type: 'string', enum: reportViews }, ...page }, Object.keys(priceInput), read],
  ['merchant_pricing_save', 'Save the original pricing report and exact captured source bytes. Retain requestId and repeat identical inputs after an interrupted reply; expectedRevision uses the pricing review head. Original native reconciliation is included when the host attached its outbox.',
    { ...priceInput, ...saveInput }, [...Object.keys(priceInput), ...Object.keys(saveInput)], { idempotent: true }],
  ['merchant_pricing_load', 'Load the original commercial inputs from a saved pricing version against the current seller configuration. Capture current observations before previewing or saving another version.',
    { ...base, version: uuid }, ['workspace', 'version'], read],
  ['merchant_pricing_compare', 'Compare two exact retained pricing reports with original seller, commercial, observation-kind and period compatibility. Page the same report view on each side.',
    { ...base, leftVersion: uuid, rightVersion: uuid, view: { type: 'string', enum: reportViews }, ...page }, ['workspace', 'leftVersion', 'rightVersion'], read],
  ['merchant_pricing_repricing_source', 'Read every complete ordered payment option from the selected original saved pricing review, its seller hash, current price-decision revision and source-release availability.',
    { ...base, version: uuid }, ['workspace', 'version'], read],
  ['merchant_pricing_repricing_preview', 'Review explicit atomic amount changes against the selected saved seller. Each edit names its route, ordered option, expected current amount and new decimal integer amount. The original compiler verifies both configurations and returns the exact review hash.',
    repriceInput, Object.keys(repriceInput), read],
  ['merchant_pricing_repricing_save', 'Retain the exact reviewed price changes, original source seller/report/terms and updated seller configuration. A configured original API package is regenerated by its original compiler. Retain requestId, reviewSha256 and the price-decision expectedRevision across retries.',
    { ...repriceInput, ...saveInput, reviewSha256: digest }, [...Object.keys(repriceInput), ...Object.keys(saveInput), 'reviewSha256'], { idempotent: true }],
  ['merchant_pricing_repricing_stage', 'Stage this retained original API price decision through its configured SF82 release store. Use the saved decision and exact reviewSha256. The same stable release ID recovers an interrupted reply; inspect and activate it with the original merchant release controls.',
    { ...base, decision: uuid, reviewSha256: digest }, ['workspace', 'decision', 'reviewSha256'], { idempotent: true }],
  ['merchant_pricing_manifest', 'Read an original saved pricing-review or price-decision manifest and its exact file hashes. kind:review uses a saved version ID; kind:decision uses a saved decision ID.',
    fileSelection, ['workspace', 'kind', 'id'], read],
  ['merchant_pricing_file', 'Read SHA-pinned chunks from a file named in the inspected original pricing manifest, including source-package files. Repeat all selectors with readId, expectedSha256 and nextOffset. Reopening a digest after expiry reads the same retained bytes.',
    { ...fileSelection, file: { type: 'string', minLength: 1, maxLength: 4096 }, expectedManifestSha256: digest,
      expectedSha256: digest, readId: uuid, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
    ['workspace', 'kind', 'id', 'file', 'expectedManifestSha256'], read],
  ['merchant_pricing_file_release', 'Release this pricing workspace\'s temporary immutable file snapshot.',
    { ...base, readId: uuid }, ['workspace', 'readId'], read],
];
export const pricingTools = tool => definitions.map(parts => tool(...parts));
const byName = new Map(definitions.map(([name, , properties, required]) => [name, object(properties, required)]));

function check(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(option => check(option, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= (schema.minimum ?? 0) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER);
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.every(item => check(schema.items, item));
  if (schema.type === 'object') return plain(value) && (schema.required ?? []).every(key => Object.hasOwn(value, key)) &&
    Object.entries(value).every(([key, item]) => Object.hasOwn(schema.properties ?? {}, key) ? check(schema.properties[key], item)
      : plain(schema.additionalProperties) ? check(schema.additionalProperties, item) : schema.additionalProperties !== false);
  if (typeof value !== schema.type) return false;
  return schema.type !== 'string' || value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) &&
    (!schema.pattern || new RegExp(schema.pattern).test(value));
}
function hostPath(value, baseDirectory) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw failure('CONFIGURATION_ERROR', 'Pricing paths must be host-selected nonempty strings.');
  return resolve(baseDirectory, value);
}
async function privateJson(path, maximum = 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum || process.platform !== 'win32' && (info.mode & 0o077))
      throw failure('CONFIGURATION_ERROR', 'Use a private regular pricing connection/runtime JSON within its size limit.');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw failure('CONFIGURATION_ERROR', 'Pricing connection/runtime JSON exceeds its size limit.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}
/** Host declarations select all source, workspace, outbox and release paths. */
export async function readPricingConfiguration(path) {
  path = resolve(path);
  const raw = await privateJson(path), baseDirectory = dirname(path);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== PRICING_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original pricing workspaces.');
  const workspaces = Object.create(null), seen = new Set();
  for (const [name, item] of Object.entries(raw.workspaces)) {
    identifier(name, 'Pricing workspace alias');
    exact(item, ['label', 'config', 'directory', 'snapshot', 'history', 'opsUrl', 'nativeOutbox', 'sourcePackage', 'releaseStore', 'releaseRuntime'], ['config', 'directory']);
    const settings = { label: line(item.label ?? name, 'Pricing workspace label'), config: hostPath(item.config, baseDirectory),
      directory: hostPath(item.directory, baseDirectory) };
    await privateSupportDirectory(settings.directory);
    const canonical = await realpath(settings.directory);
    if (canonical !== settings.directory || seen.has(canonical))
      throw failure('CONFIGURATION_ERROR', 'Use one alias per original, real pricing directory.');
    seen.add(canonical);
    for (const key of ['snapshot', 'history', 'nativeOutbox', 'sourcePackage', 'releaseStore'])
      if (item[key] !== undefined) settings[key] = hostPath(item[key], baseDirectory);
    if (item.opsUrl !== undefined) {
      let url;
      try { url = new URL(item.opsUrl); } catch { throw failure('CONFIGURATION_ERROR', 'Pricing live observations require an original loopback operations URL.'); }
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password || url.hash)
        throw failure('CONFIGURATION_ERROR', 'Pricing live observations require an original loopback operations URL.');
      settings.opsUrl = url.href;
    }
    if (!(settings.snapshot || settings.history || settings.opsUrl) || settings.opsUrl && (settings.snapshot || settings.history))
      throw failure('CONFIGURATION_ERROR', 'Choose original saved snapshot/history inputs or a live operations URL.');
    if (settings.releaseStore && !settings.sourcePackage)
      throw failure('CONFIGURATION_ERROR', 'Pricing release staging requires its original API merchant package.');
    const runtime = typeof item.releaseRuntime === 'string'
      ? await privateJson(hostPath(item.releaseRuntime, baseDirectory), 65536) : item.releaseRuntime ?? {};
    exact(runtime, ['port', 'facilitator', 'allowLocalFacilitator', 'allowLoopbackUpstream']);
    settings.releaseRuntime = normalizeReleaseRuntime(runtime);
    if (settings.releaseStore) await readReleaseState(settings.releaseStore);
    workspaces[name] = settings;
  }
  return { workspaces };
}

function pageOf(items, { offset = 0, limit = 50 } = {}, kind) {
  return { kind, total: items.length, offset, nextOffset: offset + limit < items.length ? offset + limit : null,
    items: items.slice(offset, offset + limit) };
}
function observation(value) {
  if (!value) return null;
  const { days, sessions, routes, sessionIds, ...metadata } = value;
  return { ...metadata, dayCount: days?.length ?? metadata.dayCount ?? 0,
    sessionCount: sessionIds?.length ?? metadata.sessionCount ?? (value.sessionId ? 1 : sessions?.length ?? 0),
    routeCount: routes?.length ?? metadata.routeCount ?? 0 };
}
function releaseView(value) {
  if (!value) return null;
  const { runtime, handlerEntry, ...rest } = value, { handlers, ...options } = runtime ?? {};
  return { ...rest, runtime: { ...options, applicationConfigured: Boolean(handlers || options.upstreams) },
    handlerEntry: handlerEntry ? { sha256: handlerEntry.sha256, bytes: handlerEntry.bytes, scope: handlerEntry.scope } : null };
}
function sourceView(state, args = {}) {
  const { seller, commercial: inputs, snapshot, history, repricing, ...rest } = state;
  const kind = args.view ?? 'routes';
  const lists = { routes: seller.routes.map(route => ({ ...route, commercial: inputs.routes[route.routeId] })),
    reviews: history.map(value => ({ ...value, observation: observation(value.observation) })),
    decisions: repricing.history.map(value => ({ ...value, release: releaseView(value.release) })),
    days: snapshot?.days ?? [], sessions: snapshot?.sessions ?? [], observations: snapshot?.routes ?? [] };
  return { ...rest, seller: { name: seller.name, sha256: seller.sha256, routeCount: seller.routes.length },
    commercial: { merchantName: inputs.merchantName, sharedMonthlyFixedUsd: inputs.sharedMonthlyFixedUsd },
    snapshot: observation(snapshot), captureSha256: snapshot?.sha256 ?? null,
    history: { availableReviews: history.length, scope: 'NEWEST_100' },
    repricing: { revision: repricing.revision, sourcePackageAvailable: repricing.sourcePackageAvailable,
      releaseAvailable: repricing.releaseAvailable, availableDecisions: repricing.history.length, scope: 'NEWEST_100' },
    page: pageOf(lists[kind], args, kind) };
}
function reportView(report, args = {}) {
  const { routes, issues, usageHistory, periodReview, sessionIds, ...summary } = report;
  const kind = args.view ?? 'routes';
  const lists = { routes, issues, historyDays: usageHistory?.days ?? [], historySessions: usageHistory?.sessions ?? [],
    historyRoutes: usageHistory?.routes ?? [], periodDays: periodReview?.days ?? [], periodVariants: periodReview?.variants ?? [] };
  return { ...summary, issueCount: issues.length, sessionCount: sessionIds?.length ?? (report.sessionId ? 1 : 0),
    ...(usageHistory ? { usageHistory: observation(usageHistory) } : {}),
    ...(periodReview ? { periodReview: Object.fromEntries(Object.entries(periodReview).filter(([key]) => !['days', 'variants'].includes(key))) } : {}),
    page: pageOf(lists[kind], args, kind) };
}

export class MerchantPricing {
  #config; #entries = new Map(); #files = new RetainedFileReads({ errorPrefix: 'PRICING' }); #closing = false; #close;
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.pricing), ...this.#files.summary,
      workspaces: Object.entries(this.#config.pricing?.workspaces ?? {}).map(([workspace, value]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: value.label, state: entry ? entry.closing ? 'CLOSING' : entry.model ? 'OPEN' : 'OPENING' : 'CLOSED',
          live: Boolean(value.opsUrl), sourceKinds: value.opsUrl ? ['SESSION', 'DURABLE_HISTORY'] :
            [...(value.snapshot ? ['SESSION'] : []), ...(value.history ? ['DURABLE_HISTORY'] : [])],
          nativeAttached: Boolean(value.nativeOutbox), sourcePackageAvailable: Boolean(value.sourcePackage),
          releaseAvailable: Boolean(value.releaseStore),
          operatorReleaseStore: Boolean(value.releaseStore && resolve(value.releaseStore) === resolve(this.#config.releaseStore)),
          captureSha256: entry?.source?.snapshot?.sha256 ?? null };
      }) };
  }
  #declared(name) {
    identifier(name, 'Pricing workspace alias');
    if (!Object.hasOwn(this.#config.pricing?.workspaces ?? {}, name))
      throw failure('PRICING_NOT_CONFIGURED', 'Choose a declared pricing alias from merchant_pricing_status.');
    return this.#config.pricing.workspaces[name];
  }
  #entry(name) {
    this.#declared(name);
    const entry = this.#entries.get(name);
    if (!entry?.model || entry.closing) throw failure('PRICING_NOT_OPEN', 'Finish opening the declared pricing workspace before using its original captures.');
    return entry;
  }
  async #open(name) {
    const configured = this.#declared(name);
    let entry = this.#entries.get(name);
    if (!entry) {
      // Only capture-handle ownership is shared here. Native writes continue to
      // use the original SF97 per-save CAS alongside browser/process handles.
      entry = { model: null, source: null, pending: new Set(), closing: null, opening: null };
      this.#entries.set(name, entry);
      entry.opening = (async () => {
        const { openWorkspace } = await import('../../stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/model.mjs');
        const { label, ...settings } = configured;
        const model = await openWorkspace(settings), source = await model.state();
        entry.model = model; entry.source = source;
      })();
    }
    if (entry.closing) throw failure('PRICING_CLOSING', 'The original pricing capture handle is closing.');
    try { await entry.opening; }
    catch (error) { if (this.#entries.get(name) === entry && !entry.closing) this.#entries.delete(name); throw error; }
    if (this.#closing || entry.closing) throw failure('PRICING_CLOSING', 'The original pricing capture handle is closing.');
    return { workspace: name, ...sourceView(entry.source) };
  }
  async #closeWorkspace(name) {
    this.#declared(name);
    const entry = this.#entries.get(name);
    if (!entry) return { workspace: name, state: 'CLOSED' };
    if (!entry.closing) entry.closing = (async () => {
      await entry.opening.catch(() => {});
      await Promise.allSettled([...entry.pending]);
      await this.#files.closeScope(name);
      if (this.#entries.get(name) === entry) this.#entries.delete(name);
      entry.source = null; entry.model = null;
      return { workspace: name, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  async #manifest(model, { kind, id }) {
    const bytes = await (kind === 'review' ? model.download(id, 'manifest.json') : model.downloadRepricing(id, 'manifest.json'));
    return { bytes, manifest: JSON.parse(bytes.toString('utf8')), manifestFile: { name: 'manifest.json', bytes: bytes.length, sha256: sha(bytes) } };
  }
  async #execute(name, args, entry) {
    const { workspace, view, offset, limit, ...input } = args, model = entry.model;
    switch (name) {
      case 'merchant_pricing_source': {
        if (args.captureSha256 !== undefined) {
          if (args.selection !== undefined) throw failure('PRICING_CAPTURE_CONFLICT', 'Page the captured selection, or omit captureSha256 to capture a new selection.');
          if (entry.source.snapshot?.sha256 !== args.captureSha256)
            throw failure('PRICING_CAPTURE_EXPIRED', 'The source view changed. Capture the original observations again and page its returned digest.');
        } else entry.source = await model.state(args.selection);
        return sourceView(entry.source, args);
      }
      case 'merchant_pricing_preview': return reportView(await model.preview(input), args);
      case 'merchant_pricing_save': return model.save(input);
      case 'merchant_pricing_load': return model.loadVersion(args.version);
      case 'merchant_pricing_compare': {
        const result = await model.compare(input);
        return { ...result, left: { ...result.left, observation: observation(result.left.observation), report: reportView(result.left.report, args) },
          right: { ...result.right, observation: observation(result.right.observation), report: reportView(result.right.report, args) } };
      }
      case 'merchant_pricing_repricing_source': return model.repricingSource(args.version);
      case 'merchant_pricing_repricing_preview': return model.previewRepricing(input);
      case 'merchant_pricing_repricing_save': return model.saveRepricing(input);
      case 'merchant_pricing_repricing_stage': {
        const result = await model.stageRepricing(input);
        return { ...result, release: releaseView(result.release),
          operatorReleaseStore: resolve(this.#declared(workspace).releaseStore) === resolve(this.#config.releaseStore) };
      }
      case 'merchant_pricing_manifest': {
        const { manifest, manifestFile } = await this.#manifest(model, args);
        return { kind: args.kind, id: args.id, manifest, manifestFile, fileReads: this.#files.status(workspace) };
      }
      case 'merchant_pricing_file': {
        if (args.file.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(args.file) || args.file.split('/').some(part => !part || part === '.' || part === '..'))
          throw failure('INVALID_PARAMS', 'Select a file named in the original retained pricing manifest.');
        const result = await this.#files.read({ scope: workspace, kind: 'pricing-' + args.kind,
          key: JSON.stringify([args.kind, args.id, args.file, args.expectedManifestSha256]),
          directory: this.#declared(workspace).directory, readId: args.readId, offset, limit, expectedSha256: args.expectedSha256,
          load: async () => {
            const original = await this.#manifest(model, args);
            if (original.manifestFile.sha256 !== args.expectedManifestSha256)
              throw failure('PRICING_MANIFEST_CHANGED', 'The saved pricing manifest differs from the inspected digest.');
            if (args.file === 'manifest.json') return { name: args.file, bytes: original.bytes };
            if (!Object.hasOwn(original.manifest.files, args.file))
              throw failure('PRICING_FILE_NOT_FOUND', 'Select a file named in the saved pricing manifest.');
            return { name: args.file, bytes: await (args.kind === 'review' ? model.download(args.id, args.file) : model.downloadRepricing(args.id, args.file)) };
          } });
        return { kind: args.kind, id: args.id, manifestSha256: args.expectedManifestSha256, ...result };
      }
      case 'merchant_pricing_file_release':
        await this.#files.release(workspace, args.readId); return { readId: args.readId, released: true };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown original pricing operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('PRICING_CLOSING', 'Pricing handles are closing.');
    const schema = byName.get(name);
    if (!schema || !check(schema, args)) throw failure('INVALID_PARAMS', 'Supply the declared pricing arguments and exact saved identifiers.');
    if (name === 'merchant_pricing_status') {
      if (args.workspace !== undefined) this.#declared(args.workspace);
      return { ...this.summary, workspaces: this.summary.workspaces.filter(item => args.workspace === undefined || item.workspace === args.workspace) };
    }
    if (name === 'merchant_pricing_open') return this.#open(args.workspace);
    if (name === 'merchant_pricing_close') return this.#closeWorkspace(args.workspace);
    const entry = this.#entry(args.workspace), operation = this.#execute(name, args, entry);
    entry.pending.add(operation);
    try { return { workspace: args.workspace, ...await operation }; }
    finally { entry.pending.delete(operation); }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        await Promise.all([...this.#entries.keys()].map(name => this.#closeWorkspace(name)));
        await this.#files.close();
      })();
    }
    return this.#close;
  }
}
