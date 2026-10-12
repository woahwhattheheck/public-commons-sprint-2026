import { MerchantProviderOwners } from './provider-lifecycle.mjs';
import { merchantToolCatalog, merchantToolFamilies, merchantToolFamily } from './catalog.mjs';
export { MERCHANT_TOOLS } from './catalog.mjs';
import { MERCHANT_PROVIDERS, merchantProviderConfigured } from './providers.mjs';


// MIT. MCP merchant operations over the original SF82 release lifecycle and SF30 SDK.
import { createHash } from 'node:crypto';


import { exact, failure, identifier, line, readMerchantConfig, inspectMerchantSource, pythonSourceView, duckdbSourceView } from './config.mjs';


import { datasetReleaseView } from './catalog/dataset-lifecycle.mjs';


const hash = bytes => createHash('sha256').update(bytes).digest('hex');


// The original release return values contain local handler/store paths. The MCP
// interface needs their hashes and process identities, not executable locations.
function releaseView(release) {
  if (!release) return null;
  const { handlerEntry, runtime, ...rest } = release;
  const { handlers, ...options } = runtime;
  return { ...rest, ...(rest.python ? { python: pythonSourceView(rest.python) } : {}),
    ...(rest.duckdb ? { duckdb: duckdbSourceView(rest.duckdb) } : {}),
    ...(rest.dataset ? { dataset: datasetReleaseView(rest.dataset) } : {}),
    runtime: { ...options, applicationConfigured: Boolean(handlers || runtime.upstreams || rest.python || rest.duckdb || rest.mysql || rest.postgres || rest.s3 || rest.jsonrpc || rest.sqlite || rest.clickhouse || rest.redis || rest.dataset || rest.opensearch || rest.mssql || rest.grpc) },
    handlerEntry: handlerEntry ? { sha256: handlerEntry.sha256, bytes: handlerEntry.bytes, scope: handlerEntry.scope } : null };
}
function runtimeView(runtime) {
  const observed = runtime.observed;
  return { state: runtime.state, message: runtime.message ?? null,
    managerAlive: runtime.managerAlive ?? null, childAlive: runtime.childAlive ?? null,
    observed: observed ? Object.fromEntries(['instanceId', 'releaseId', 'releaseDigest', 'selectionGeneration', 'listener', 'operations',
      'mode', 'phase', 'startedAt', 'readyAt', 'endedAt', 'exitCode', 'exitSignal'].filter(key => Object.hasOwn(observed, key)).map(key => [key, observed[key]])) : null };
}
function generation(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw failure('INVALID_PARAMS', 'Use the current nonnegative selection generation.');
  return value;
}
function expectedDigest(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw failure('INVALID_PARAMS', 'Use the inspected release digest.');
  return value;
}

export class MerchantReleaseOperator {
  #providerOwners; #activeDetails = new Map();
  get activity() {
    return [...this.#activeDetails.values()].map(({ started, ...entry }) => ({ ...entry,
      elapsedMs: Math.round((performance.now() - started) * 1000) / 1000 }));
  }
  get providerShutdown() { return this.#providerOwners.shutdown; }

  #tools; #definitions; #mutations; #options;
  #providers = new Map(); #loaded = new Map(); #loadStates = new Map();
  #provider(key, dependency = false) { return this.#providerOwners.resolve(key, dependency); }

  #config; #managed = null; #busy = false; #closing = false; #active = new Set(); #close; #lastFailure = null;                                  
       
  
  constructor(config, { stellarExpert, woocommerce, mpp, opensearch, grpc, openapi, accounting, arcgis, opencage } = {}) {
    this.#config = config;
    this.#options = { stellarExpert, woocommerce, mpp, opensearch, grpc, openapi, accounting, arcgis, opencage };
    this.#providerOwners = new MerchantProviderOwners({ definitions: MERCHANT_PROVIDERS, config: this.#config, options: this.#options,
      loads: this.#providers, instances: this.#loaded, states: this.#loadStates, failure });
    this.#tools = structuredClone(merchantToolCatalog(config));
    this.#definitions = new Map(this.#tools.map(value => [value.name, value]));
    this.#mutations = new Set(this.#tools.filter(value => !value.annotations.readOnlyHint).map(value => value.name));
  }
  get tools() { return structuredClone(this.#tools); }

  #hostFingerprint;
  inspectHost() {
    if(!this.#hostFingerprint) {
      const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':
        value&&typeof value==='object'?'{'+Object.keys(value).sort().filter(key=>value[key]!==undefined)
          .map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
      this.#hostFingerprint=hash(stable(this.#config));
    }
    return {schema:'stellar-forge.merchant-host-profile.v1',merchant:this.#config.name,
      configurationFingerprint:this.#hostFingerprint,maxRequestBytes:this.maxRequestBytes,
      capabilities:{tools:this.#tools.length,families:merchantToolFamilies(this.#config)},
      providers:Object.entries(MERCHANT_PROVIDERS)
        .filter(([name])=>merchantProviderConfigured(name,this.#config)||this.#loadStates.has(name))
        .map(([name,definition])=>({name,configured:merchantProviderConfigured(name,this.#config),
          dependencies:[...definition.dependencies],...(this.#loadStates.get(name)??{state:'UNLOADED',durationMs:null})})),
      sources:Object.entries(this.#config.sources??{}).map(([source,value])=>({source,label:value.label})),
      activity:this.activity,providerShutdown:this.providerShutdown,
      operator:{busy:this.#busy,closing:this.#closing,activeCalls:this.#active.size,lastFailure:this.#lastFailure,
        managesRunningSeller:Boolean(this.#managed),instanceId:this.#managed?.observation.instanceId??null}};
  }

  get maxRequestBytes() {
    const configuredMaximum = (() => {
      if (this.#config.grantWorkspaces) return 32 * 1024 * 1024;
      if (this.#config.graphqlWorkspaces || this.#config.dspaceOperators) return 8 * 1024 * 1024;
      return this.#config.mpp ? 3 * 1024 * 1024 : (this.#config.opensearchWorkspaces || this.#config.grpcWorkspaces || this.#config.usgsWorkspaces) ? 2 * 1024 * 1024 : this.#config.grantsWorkspaces ? 512 * 1024 : 128 * 1024;
    })();
    return Math.max(configuredMaximum, this.#config.feedsWorkspaces ? 16 * 1024 * 1024 + 65536 : 0,
      this.#config.researchWorkspaces ? 2 * 1024 * 1024 : 0,
      this.#config.nocodbWorkspaces ? 1024 * 1024 : 0,
      this.#config.n8nWorkspaces ? 2 * 1024 * 1024 : 0,
      this.#config.paidJobWorkspaces ? 2 * 1024 * 1024 : 0);
  }
  async #status() {
    const result = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).releaseStatus(this.#config.releaseStore);
    const summaries = Object.fromEntries(await Promise.all(Object.entries(MERCHANT_PROVIDERS)
      .filter(([key, value]) => value.summary && merchantProviderConfigured(key, this.#config))
      .map(async ([key]) => [key, (await this.#providerOwners.invoke(key, provider => provider.summary))])));
    return { schema: 'stellar-forge.merchant-mcp-status.v1', merchant: this.#config.name,
      state: result.state, releases: result.releases.map(releaseView), errors: result.errors,
      runtime: runtimeView(result.runtime), operator: { managesRunningSeller: Boolean(this.#managed),
        instanceId: this.#managed?.observation.instanceId ?? null, busy: this.#busy,
        closing: this.#closing, lastFailure: this.#lastFailure, activity: this.activity, shutdown: this.providerShutdown, ...summaries,
        capabilities: { tools: this.#tools.length, families: merchantToolFamilies(this.#config) },
        providers: [...this.#loadStates].map(([name, state]) => ({ name, ...state })) } };
  }
  status() { return this.call('merchant_status'); }
  #owned(instanceId) {
    if (typeof instanceId !== 'string' || !this.#managed || instanceId !== this.#managed.observation.instanceId)
      throw failure('INSTANCE_CONFLICT', 'This MCP process does not own that seller instance. Read merchant_status.');
    return this.#managed;
  }
  async #selected(args) {
    const state = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(this.#config.releaseStore);
    if (state.generation !== generation(args.expectedGeneration)) throw failure('RELEASE_CONFLICT', 'Selection changed. Read merchant_status and compare the current release.');
    if (!state.active) throw failure('RELEASE_NOT_SELECTED', 'Activate a staged release before starting.');
    const release = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).inspectRelease(this.#config.releaseStore, state.active);
    if (release.digest !== expectedDigest(args.expectedDigest)) throw failure('RELEASE_CONFLICT', 'Selected release differs from the inspected digest.');
    return { state, release };
  }
  async #start(args) {
    await this.#selected(args);
    if (this.#managed) throw failure('RELEASE_BUSY', 'This MCP process already owns a seller. Use merchant_restart or merchant_stop.');
    const session = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).runActiveRelease(this.#config.releaseStore, { expectedGeneration: args.expectedGeneration });
    this.#managed = session;
    session.completion.then(() => { if (this.#managed === session) this.#managed = null; }, error => {
      this.#lastFailure = { code: error.code ?? 'SELLER_EXIT', message: error.message };
      if (this.#managed === session) this.#managed = null;
    });
  }
  async #stop(instanceId) {
    const session = this.#owned(instanceId);
    const stopped = await session.close();
    if (this.#managed === session) this.#managed = null;
    return stopped;
  }
  async #catalog(instanceId) {
    const session = this.#owned(instanceId);
    return (await import('./client-exports.mjs')).readOwnedSellerCatalog({ session, isCurrent: candidate => this.#managed === candidate });
  }
  async #sources(source) {
    const aliases = Object.keys(this.#config.sources);
    if (source === undefined) return { merchant: this.#config.name, sources: aliases.map(alias => ({ source: alias, label: this.#config.sources[alias].label })) };
    identifier(source, 'Source alias');
    const candidate = this.#config.sources[source];
    if (!candidate) throw failure('SOURCE_NOT_FOUND', 'Choose one of the host-configured source aliases.');
    return inspectMerchantSource(candidate);
  }
  async #execute(name, args) {
    if (name.startsWith('merchant_client_export_')) return this.#providerOwners.invoke('clientExports', provider => provider.call(name, args));
    const family = merchantToolFamily(name);
    if (family && !['cache', 'dataset', 'discovery', 'facilitators'].includes(family)) return this.#providerOwners.invoke(family, provider => provider.call(name, args));

    const root = this.#config.releaseStore;
    if (name.startsWith('merchant_dataset_')) return this.#providerOwners.invoke('dataset', provider => provider.merchantDatasetOperation(root, name, args));
    
    switch (name) {
      case 'merchant_status': return this.#status();
      case 'merchant_sources': return this.#sources(args.source);
      case 'merchant_facilitators': return this.#providerOwners.invoke('facilitators', provider => provider.status());
      case 'merchant_facilitator_review': return this.#providerOwners.invoke('facilitators', provider => provider.review(args));
      case 'merchant_facilitator_stage': {
        const result = await this.#providerOwners.invoke('facilitators', provider => provider.stage(args));
        return { ...result, release: releaseView(result.release) };
      }
      case 'merchant_operations': {
        const session = this.#owned(args.instanceId);
        return { instanceId: session.observation.instanceId, releaseId: session.release.id,
          available: Boolean(session.operations), operations: session.operations ? { ...session.operations } : null };
      }
      case 'merchant_discovery_status': return this.#providerOwners.invoke('discovery', provider => provider.status(args));
      case 'merchant_discovery_review': return this.#providerOwners.invoke('discovery', provider => provider.review(args));
      case 'merchant_discovery_apply': return this.#providerOwners.invoke('discovery', provider => provider.apply(args));
      case 'merchant_cache_status': return this.#providerOwners.invoke('cache', provider => provider.merchantCacheStatus(root));
      case 'merchant_cache_invalidate': this.#owned(args.instanceId); return this.#providerOwners.invoke('cache', provider => provider.merchantCacheInvalidate(root, args));
      case 'merchant_cache_inspect': this.#owned(args.instanceId); return this.#providerOwners.invoke('cache', provider => provider.merchantCacheInspect(root, args));
      case 'merchant_cache_configure': this.#owned(args.instanceId); return this.#providerOwners.invoke('cache', provider => provider.merchantCacheConfigure(root, args));
      case 'merchant_cache_purge': this.#owned(args.instanceId); return this.#providerOwners.invoke('cache', provider => provider.merchantCachePurge(root, args));
      case 'merchant_cache_operation': this.#owned(args.instanceId); return this.#providerOwners.invoke('cache', provider => provider.merchantCacheOperation(root, args));
      case 'merchant_inspect': return releaseView(await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).inspectRelease(root, identifier(args.id)));
      case 'merchant_stage': {
        const alias = identifier(args.source, 'Source alias'), source = this.#config.sources[alias];
        if (!source) throw failure('SOURCE_NOT_FOUND', 'Choose one of the host-configured source aliases.');
        const release = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).stageRelease(root, { ...source, id: identifier(args.id), label: line(args.label ?? args.id, 'Release label') });
        return { source: alias, release: releaseView(release) };
      }
      case 'merchant_compare': {
        const state = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(root), from = args.from === undefined ? state.active : args.from;
        const comparison = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).compareReleases(root, from === null ? null : identifier(from), identifier(args.to));
        return { ...comparison, generation: state.generation, before: releaseView(comparison.before), after: releaseView(comparison.after),
          runtimeChanges: comparison.runtimeChanges.map(change => change.field === 'handlers'
            ? { field: 'applicationConfigured', before: Boolean(change.before), after: Boolean(change.after) }
            : change.field === 'python' ? { ...change, before: pythonSourceView(change.before), after: pythonSourceView(change.after) }
            : change.field === 'duckdb' ? { ...change, before: duckdbSourceView(change.before), after: duckdbSourceView(change.after) }
            : change.field === 'dataset' ? { ...change, before: datasetReleaseView(change.before), after: datasetReleaseView(change.after) } : change) };
      }
      case 'merchant_activate': case 'merchant_rollback': {
        const target = identifier(name === 'merchant_activate' ? args.id : args.to);
        const release = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).inspectRelease(root, target);
        if (release.digest !== expectedDigest(args.expectedDigest)) throw failure('RELEASE_CONFLICT', 'Release differs from the inspected digest.');
        const options = { expectedGeneration: generation(args.expectedGeneration), reason: line(args.reason, 'Change reason') };
        const result = name === 'merchant_activate' ? await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).activateRelease(root, target, options) : await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).rollbackRelease(root, { ...options, to: target });
        return { ...result, status: await this.#status() };
      }
      case 'merchant_start': await this.#start(args); return this.#status();
      case 'merchant_stop': return { stopped: await this.#stop(args.instanceId), status: await this.#status() };
      case 'merchant_restart': {
        this.#owned(args.instanceId); await this.#selected(args);
        const stopped = await this.#stop(args.instanceId);
        await this.#start(args);
        return { stopped, status: await this.#status() };
      }
      case 'merchant_catalog': {
        const { session, health, offers, openapi } = await this.#catalog(args.instanceId);
        return { instanceId: session.observation.instanceId, releaseId: session.release.id, releaseDigest: session.release.digest,
          health: health.value, offers: offers.value, openapi: openapi.value, openapiSha256: hash(openapi.bytes) };
      }
      case 'merchant_client_export': {
        const exportId = identifier(args.id, 'Export ID');
        const { session, openapi } = await this.#catalog(args.instanceId);
        return this.#providerOwners.invoke('clientExports', provider => provider.generate({ exportId, session, openapi }));
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown merchant operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'Merchant operator is closing.');
    const definition = this.#definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Choose a tool advertised by this configured merchant.');
    exact(args, Object.keys(definition.inputSchema.properties), definition.inputSchema.required);
    const family = merchantToolFamily(name), owner = MERCHANT_PROVIDERS[family];
    const changing = this.#mutations.has(name);
    const serialized = changing && owner?.concurrency !== 'provider' && !owner?.concurrentTools?.includes(name);
    if (serialized && this.#busy) throw failure('OPERATOR_BUSY', 'Another merchant change is running. Read merchant_status before continuing.');
    if (serialized) this.#busy = true;
    if (changing) this.#lastFailure = null;
    let done;
    const active = new Promise(resolve => { done = resolve; });
    this.#active.add(active);
    this.#activeDetails.set(active, { tool: name, provider: family ?? 'core', changing, serialized,
      startedAt: new Date().toISOString(), started: performance.now() });
    try {
      const result = await this.#execute(name, args);
      if (serialized) {
        this.#busy = false;
        if (result?.operator) result.operator.busy = false;
        if (result?.status?.operator) result.status.operator.busy = false;
      }
      return result;
    } catch (error) {
      if (changing) this.#lastFailure = { code: error.code ?? 'OPERATOR_ERROR', message: error.message, tool: name, provider: family ?? 'core' };
      throw error;
    } finally {
      if (serialized) this.#busy = false;
      this.#active.delete(active);
      this.#activeDetails.delete(active);
      done();
    }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#providerOwners.beginClose();
    this.#close = (async () => {
      // Declared native owners can cancel and drain their accepted work now.
      // All other owners close after every accepted host call has settled.
      await Promise.allSettled([...this.#active]);
      const outcomes = await Promise.allSettled([
        this.#providerOwners.finishClose(),
        this.#managed ? this.#stop(this.#managed.observation.instanceId) : Promise.resolve(),
      ]);
      const errors = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) {
        const error = failure('OPERATOR_SHUTDOWN_INCOMPLETE', 'Original owned runtimes have not finished closing; retry close on this operator.');
        error.providers = errors.flatMap(cause => cause.providers ?? []);
        if (this.#managed) error.sellerInstanceId = this.#managed.observation.instanceId;
        throw error;
      }
    })().catch(error => {
      this.#close = null;
      this.#lastFailure = { code: error.code ?? 'OPERATOR_SHUTDOWN_INCOMPLETE', message: error.message };
      throw error;
    });
    return this.#close;
  }
}
export async function openMerchantOperator(configPath, options) {
  return new MerchantReleaseOperator(await readMerchantConfig(configPath), options);
}
