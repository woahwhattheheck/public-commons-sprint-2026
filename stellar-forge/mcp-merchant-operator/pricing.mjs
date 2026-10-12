import { pricingTools, definitions, base, read, selection, digest, sourceViews, page, priceInput, reportViews, saveInput, uuid, scenarioInput, scenarioPage, scenarioId, repriceInput, fileSelection, alias, object, nullableText, commercial, revision, scenario, scenarioViews, scenarioChoice, suggestionKind, edits, optionalUsd, usd, scenarioGoal } from './catalog/pricing.mjs';
export { pricingTools } from './catalog/pricing.mjs';
// MIT. Original SF97 pricing decisions over the merchant's existing MCP transport.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { costToolDefinitions, normalizePricingCostSources, MerchantPricingCosts, PricingCostArchiveReads } from './pricing-costs.mjs';
import { normalizeReleaseRuntime, readReleaseState } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';

export const PRICING_CONNECTION_SCHEMA = 'stellar-forge.pricing-workspace-connection.v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');






























const byName = new Map(definitions.map(([name, , properties, required]) => [name, object(properties, required)]));

function check(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(option => check(option, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= (schema.minimum ?? 0) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER);
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Infinity) && value.every(item => check(schema.items, item));
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
    exact(item, ['label', 'config', 'directory', 'snapshot', 'history', 'opsUrl', 'nativeOutbox', 'sourcePackage', 'releaseStore', 'releaseRuntime', 'costInputs', 'costBooks', 'costPackages', 'supplierUsage', 'accountingReport'], ['config', 'directory']);
    const settings = { label: line(item.label ?? name, 'Pricing workspace label'), config: hostPath(item.config, baseDirectory),
      directory: hostPath(item.directory, baseDirectory) };
    await privateSupportDirectory(settings.directory);
    const canonical = await realpath(settings.directory);
    if (canonical !== settings.directory || seen.has(canonical))
      throw failure('CONFIGURATION_ERROR', 'Use one alias per original, real pricing directory.');
    seen.add(canonical);
    Object.assign(settings, normalizePricingCostSources(item, baseDirectory));
    for (const key of ['snapshot', 'history', 'nativeOutbox', 'sourcePackage', 'releaseStore', 'supplierUsage', 'accountingReport'])
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

function scenarioMetrics(value) {
  const { routes, ...summary } = value;
  return { ...summary, routeCount: routes.length };
}
function scenarioSuggestion(value) {
  const { commercial, terms, volumes, metrics, ...summary } = value;
  return { ...summary, ...(metrics ? { metrics:scenarioMetrics(metrics) } : {}),
    ...(volumes ? { volumeRouteCount:volumes.length } : {}) };
}
function scenarioSummary(row) {
  return { id:row.id,label:row.label,overview:row.overview,metrics:scenarioMetrics(row.metrics),delta:row.delta ? {
    ...Object.fromEntries(Object.entries(row.delta).filter(([key]) => key !== 'routeChanges')),
    changedRouteCount:row.delta.routeChanges.length } : null,
    goals:{ requested:row.goals.requested,current:row.goals.current,
      suggestions:row.goals.suggestions.map(scenarioSuggestion) } };
}
function planningReviewView(review, args = {}) {
  const kind = args.view ?? 'scenarios';
  const selected = [review.baseline,...review.scenarios].find(row => row.id === (args.scenarioId ?? 'baseline'));
  if (!selected) throw failure('PRICING_SCENARIO_NOT_FOUND', 'Choose an original scenario ID from this comparison.');
  let items;
  if (kind === 'scenarios') items = review.scenarios.map(scenarioSummary);
  if (kind === 'routes') items = selected.metrics.routes.map(route => ({ ...route,
    commercial:selected.commercial.routes[route.routeId],terms:selected.terms.routes[route.routeId] }));
  if (kind === 'goals') items = selected.goals.suggestions.map(scenarioSuggestion);
  if (kind === 'suggestionRoutes') {
    const suggestion = selected.goals.suggestions.find(item => item.kind === args.suggestionKind);
    if (!suggestion) throw failure('PRICING_SUGGESTION_REQUIRED', 'Choose an exact suggestionKind returned for this scenario.');
    items = (suggestion.metrics?.routes ?? []).map(route => ({ ...route,
      commercial:suggestion.commercial.routes[route.routeId],terms:suggestion.terms.routes[route.routeId] }));
  }
  return { schema:review.schema,reviewSha256:review.reviewSha256,source:review.source,generatedAt:review.generatedAt,
    baseline:scenarioSummary(review.baseline),scenarioCount:review.scenarios.length,
    selectedScenarioId:selected.id,selectedScenario:scenarioSummary(selected),
    page:pageOf(items,args,kind) };
}
function planningRecordView(record, args = {}) {
  const { review,inputs,...metadata } = record;
  return { ...metadata,review:planningReviewView(review,args) };
}
function planningSourceView(source, args = {}) {
  const { routes,commercial:inputs,...metadata } = source;
  return { ...metadata,commercial:{merchantName:inputs.merchantName,sharedMonthlyFixedUsd:inputs.sharedMonthlyFixedUsd},
    routeCount:routes.length,page:pageOf(routes.map(route => ({...route,commercial:inputs.routes[route.routeId]})),args,'routes') };
}
function planningSelectionView(value,args = {}) {
  const {commercial:inputs,...metadata}=value;
  return {...metadata,commercial:{merchantName:inputs.merchantName,sharedMonthlyFixedUsd:inputs.sharedMonthlyFixedUsd},
    page:pageOf(Object.entries(inputs.routes).map(([routeId,commercial])=>({routeId,commercial})),args,'routes')};
}

export class MerchantPricing {
  #config; #entries = new Map(); #files = new RetainedFileReads({ errorPrefix: 'PRICING' }); #costArchives = new PricingCostArchiveReads(); #closing = false; #close;
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.pricing), ...this.#files.summary, ...this.#costArchives.summary,
      workspaces: Object.entries(this.#config.pricing?.workspaces ?? {}).map(([workspace, value]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: value.label, state: entry ? entry.closing ? 'CLOSING' : entry.model ? 'OPEN' : 'OPENING' : 'CLOSED',
          live: Boolean(value.opsUrl), sourceKinds: value.opsUrl ? ['SESSION', 'DURABLE_HISTORY'] :
            [...(value.snapshot ? ['SESSION'] : []), ...(value.history ? ['DURABLE_HISTORY'] : [])],
          costSourceInputs: Object.keys(value.costInputs ?? {}).length, costBookInputs: Object.keys(value.costBooks ?? {}).length,
          costPackageInputs: Object.keys(value.costPackages ?? {}).length,
          costConfiguredCaptures: [...(value.supplierUsage ? ['USAGE'] : []), ...(value.accountingReport ? ['ACCOUNTING'] : [])],
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
      entry = { model: null, planning: null, costs: null, source: null, pending: new Set(), closing: null, opening: null };
      this.#entries.set(name, entry);
      entry.opening = (async () => {
        const { openWorkspace } = await import('../../stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/model.mjs');
        const { label, costInputs, costBooks, costPackages, ...settings } = configured;
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
      await this.#costArchives.closeScope(name);
      if (this.#entries.get(name) === entry) this.#entries.delete(name);
      entry.source = null; entry.model = null; entry.planning = null; entry.costs = null;
      return { workspace: name, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  async #planning(entry, workspace) {
    entry.planning ??= (async () => {
      const { openPlanningWorkspace } = await import('../../stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/planning/workspace.mjs');
      return openPlanningWorkspace({model:entry.model,directory:this.#declared(workspace).directory});
    })();
    try { return await entry.planning; } catch (error) { entry.planning=null;throw error; }
  }
  async #manifest(entry, { workspace,kind,id }) {
    let bytes;
    if (kind === 'scenario') {
      const planning=await this.#planning(entry,workspace), record=await planning.load(id), files={};
      const names=['plan.json','comparison.csv',...record.review.scenarios.map(row=>'terms-'+row.id+'.json')];
      for (const name of names) {
        const data=await planning.download(id,name);
        files[name]={bytes:data.length,sha256:sha(data)};
      }
      bytes=Buffer.from(JSON.stringify({schema:'stellar-forge.merchant-scenario-files.v1',planId:id,
        version:record.version,reviewSha256:record.review.reviewSha256,files},null,2)+'\n');
    } else bytes=await (kind === 'review' ? entry.model.download(id,'manifest.json') : entry.model.downloadRepricing(id,'manifest.json'));
    return {bytes,manifest:JSON.parse(bytes.toString('utf8')),manifestFile:{name:'manifest.json',bytes:bytes.length,sha256:sha(bytes)}};
  }
  async #execute(name, args, entry) {
    if (name.startsWith('merchant_pricing_cost_')) {
      entry.costs ??= new MerchantPricingCosts({settings:this.#declared(args.workspace),model:()=>entry.model,
        files:this.#files,archives:this.#costArchives});
      return entry.costs.call(name,args);
    }
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
      case 'merchant_pricing_planning_source':
        return planningSourceView(await (await this.#planning(entry,workspace)).source(args.version),args);
      case 'merchant_pricing_planning_preview': {
        const result=await (await this.#planning(entry,workspace)).preview({version:args.version,scenarios:args.scenarios});
        return {...result,review:planningReviewView(result.review,args)};
      }
      case 'merchant_pricing_planning_save': {
        const result=await (await this.#planning(entry,workspace)).save(input);
        return {...result,record:planningRecordView(result.record,args)};
      }
      case 'merchant_pricing_planning_list': {
        const result=await (await this.#planning(entry,workspace)).list();
        return {total:result.total,retainedInListing:result.plans.length,scope:'NEWEST_100',page:pageOf(result.plans,args,'plans')};
      }
      case 'merchant_pricing_planning_load':
        return planningRecordView(await (await this.#planning(entry,workspace)).load(args.planId),args);
      case 'merchant_pricing_planning_selection':
        return planningSelectionView(await (await this.#planning(entry,workspace)).selection({planId:args.planId,scenarioId:args.scenarioId}),args);
      case 'merchant_pricing_planning_apply': {
        const record=await (await this.#planning(entry,workspace)).load(args.planId);
        if (record.review.reviewSha256 !== args.reviewSha256)
          throw failure('PRICING_SCENARIO_REVIEW_CHANGED','Use the inspected saved comparison reviewSha256.');
        if (record.source.seller !== args.sellerSha256)
          throw failure('PRICING_SCENARIO_SELLER_CHANGED','The selected plan belongs to a different seller configuration.');
        const selected=record.review.scenarios.find(row=>row.id===args.scenarioId);
        if (!selected) throw failure('PRICING_SCENARIO_NOT_FOUND','Choose an original scenario ID from this comparison.');
        // Original save owns current seller/capture/CAS validation and same-ID
        // recovery, including recovery after the current seller later changes.
        const saved=await model.save({sellerSha256:args.sellerSha256,snapshotSha256:args.snapshotSha256,
          commercial:structuredClone(selected.commercial),requestId:args.requestId,
          expectedRevision:args.expectedRevision,label:args.label});
        return {...saved,planId:args.planId,scenarioId:args.scenarioId,reviewSha256:args.reviewSha256};
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
        const { manifest, manifestFile } = await this.#manifest(entry, args);
        return { kind: args.kind, id: args.id, manifest, manifestFile, fileReads: this.#files.status(workspace) };
      }
      case 'merchant_pricing_file': {
        if (args.file.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(args.file) || args.file.split('/').some(part => !part || part === '.' || part === '..'))
          throw failure('INVALID_PARAMS', 'Select a file named in the original retained pricing manifest.');
        const result = await this.#files.read({ scope: workspace, kind: 'pricing-' + args.kind,
          key: JSON.stringify([args.kind, args.id, args.file, args.expectedManifestSha256]),
          directory: this.#declared(workspace).directory, readId: args.readId, offset, limit, expectedSha256: args.expectedSha256,
          load: async () => {
            const original = await this.#manifest(entry, args);
            if (original.manifestFile.sha256 !== args.expectedManifestSha256)
              throw failure('PRICING_MANIFEST_CHANGED', 'The saved pricing manifest differs from the inspected digest.');
            if (args.file === 'manifest.json') return { name: args.file, bytes: original.bytes };
            if (!Object.hasOwn(original.manifest.files, args.file))
              throw failure('PRICING_FILE_NOT_FOUND', 'Select a file named in the saved pricing manifest.');
            return { name: args.file, bytes: await (args.kind === 'scenario' ? (await this.#planning(entry,workspace)).download(args.id,args.file) : args.kind === 'review' ? model.download(args.id,args.file) : model.downloadRepricing(args.id,args.file)) };
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
        await this.#costArchives.close();
      })();
    }
    return this.#close;
  }
}
