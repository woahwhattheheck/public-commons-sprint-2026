// MIT. MCP merchant operations over the original SF82 release lifecycle and SF30 SDK.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { stageRelease, inspectRelease, compareReleases, activateRelease, rollbackRelease,
  readReleaseState, releaseStatus, runActiveRelease } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import { exportSellerClient, inspectSellerClientExport, adoptSellerClientExport, readSellerClientManifest,
  readSellerClientFile, CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { exact, failure, identifier, line, writePrivate, readMerchantConfig, inspectMerchantSource, pythonSourceView, duckdbSourceView } from './config.mjs';
import { MerchantDiscovery, discoveryTools } from './discovery.mjs';
import { cacheControlTools, merchantCacheStatus, merchantCacheInvalidate } from './controls.mjs';
import { MerchantFleet, fleetControlTools } from './fleet.mjs';
import { MerchantAccounting, accountingTools } from './accounting.mjs';
import { MerchantSupport, supportTools } from './support.mjs';
import { MerchantReceiving, receivingTools } from './receiving.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const idSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const generationSchema = { type: 'integer', minimum: 0 };
const digestSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const textSchema = { type: 'string', minLength: 1, maxLength: 240 };
const instanceSchema = { type: 'string', minLength: 1, maxLength: 64 };
function tool(name, description, properties = {}, required = [], { readOnly = false, destructive = false, idempotent = false, openWorld = false } = {}) {
  return { name, description, annotations: { readOnlyHint: readOnly, destructiveHint: destructive,
    idempotentHint: idempotent, openWorldHint: openWorld },
    inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}
export const MERCHANT_TOOLS = [
  tool('merchant_status', 'Inspect original release selection, retained history, seller readiness and this MCP process ownership. Makes only original loopback health/offer reads.', {}, [], { readOnly: true, idempotent: true }),
  tool('merchant_sources', 'List configured aliases or inspect an original API package, OpenAPI files, Python merchant, SQLite workbench, prepared DuckDB, S3, Stellar RPC or MySQL package: exact source identities, public routes, payment choices and worker configuration. Reads configured local files without credential values, application imports or HTTP calls.', { source: idSchema }, [], { readOnly: true, idempotent: true }),
  tool('merchant_stage', 'Retain a configured source alias as a new immutable original SF82 release: saved API workspace, upstream snapshot, Python application, original DuckDB datasets, S3 objects, Stellar RPC product one native SQLite database snapshot or original prepared MySQL merchant. Does not activate, import application code, start a listener or make a payment.',
    { source: idSchema, id: idSchema, label: textSchema }, ['source', 'id']),
  tool('merchant_inspect', 'Inspect and verify one retained original release including complete terms, application hashes and native/challenge mode.', { id: idSchema }, ['id'], { readOnly: true, idempotent: true }),
  tool('merchant_compare', 'Compare a staged release against the active release or a named retained version. Returns exact payment, route and application changes with the selection generation.',
    { to: idSchema, from: { anyOf: [idSchema, { type: 'null' }] } }, ['to'], { readOnly: true, idempotent: true }),
  tool('merchant_activate', 'Select an inspected immutable release using its exact digest and current selection generation. A running seller keeps its existing version until explicitly restarted.',
    { id: idSchema, expectedDigest: digestSchema, expectedGeneration: generationSchema, reason: textSchema }, ['id', 'expectedDigest', 'expectedGeneration', 'reason']),
  tool('merchant_rollback', 'Select a specific retained release through the original rollback history. Requires its exact digest and current generation; does not restart the seller.',
    { to: idSchema, expectedDigest: digestSchema, expectedGeneration: generationSchema, reason: textSchema }, ['to', 'expectedDigest', 'expectedGeneration', 'reason']),
  tool('merchant_start', 'Start the original SF82/SF30 seller for the selected release on this host, with its host-configured trusted handlers and facilitator. No paid resource is requested.',
    { expectedGeneration: generationSchema, expectedDigest: digestSchema }, ['expectedGeneration', 'expectedDigest'], { openWorld: true }),
  tool('merchant_stop', 'Gracefully stop only the original seller instance owned by this MCP process. Pass the instanceId from merchant_status.',
    { instanceId: instanceSchema }, ['instanceId'], { destructive: true }),
  tool('merchant_restart', 'Gracefully stop this process-owned seller and start the currently selected original release. Checks instance, generation and digest before stopping.',
    { instanceId: instanceSchema, expectedGeneration: generationSchema, expectedDigest: digestSchema }, ['instanceId', 'expectedGeneration', 'expectedDigest'], { destructive: true, openWorld: true }),
  tool('merchant_catalog', 'Read the actual original seller health, complete offers and OpenAPI document for this process-owned instance. Does not request any paid endpoint.',
    { instanceId: instanceSchema }, ['instanceId'], { readOnly: true, idempotent: true }),
  tool('merchant_client_export', 'Export the original JavaScript client, TypeScript declarations and OpenAPI for this running seller into a new named directory under the host-configured customer export root.',
    { instanceId: instanceSchema, id: idSchema }, ['instanceId', 'id']),
  tool('merchant_client_export_status', 'Inspect the complete original customer export after a lost response or seller shutdown. Verifies saved files and reports a completion receipt, retained legacy files or an incomplete export without running the seller or generated code.',
    { exportId: idSchema }, ['exportId'], { readOnly: true, idempotent: true }),
  tool('merchant_client_export_adopt', 'Record the exact inspected five legacy customer files as retained today. Requires their complete files digest, preserves all payloads, and does not invent a historical export time or release identity.',
    { exportId: idSchema, expectedFilesSha256: digestSchema }, ['exportId', 'expectedFilesSha256'], { idempotent: true }),
  tool('merchant_client_export_manifest', 'Read the saved original customer completion receipt and its exact file identity without rereading all payloads. Available after seller or MCP process restart.',
    { exportId: idSchema }, ['exportId'], { readOnly: true, idempotent: true }),
  tool('merchant_client_export_file', 'Read bounded SHA-pinned bytes from one original customer file or its completion receipt. Continue with readId and expectedSha256; after expiry, reopen the same digest and byte offset. Never regenerates or executes the client.',
    { exportId: idSchema, file: { type: 'string', enum: [CLIENT_EXPORT_MANIFEST, ...CLIENT_EXPORT_FILES] }, expectedManifestSha256: digestSchema,
      expectedSha256: digestSchema, readId: { type: 'string' }, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
    ['exportId', 'file', 'expectedManifestSha256'], { readOnly: true, idempotent: true }),
  tool('merchant_client_export_file_release', 'Release this original export’s temporary file snapshot. The retained customer payloads and completion receipt remain available.',
    { exportId: idSchema, readId: { type: 'string' } }, ['exportId', 'readId'], { readOnly: true, idempotent: true }),
  tool('merchant_operations', 'Open the original RPC merchant operations, retained history and private availability controls for this process-owned running instance. The control link grants availability changes; keep it in the operator session.',
    { instanceId: instanceSchema }, ['instanceId'], { readOnly: true, idempotent: true }),
  ...discoveryTools(tool),
  ...cacheControlTools(tool),
  ...fleetControlTools(tool),
  ...accountingTools(tool),
  ...supportTools(tool),
  ...receivingTools(tool),
];
const definitions = new Map(MERCHANT_TOOLS.map(value => [value.name, value]));
const mutations = new Set(MERCHANT_TOOLS.filter(value => !value.annotations.readOnlyHint).map(value => value.name));

// The original release return values contain local handler/store paths. The MCP
// interface needs their hashes and process identities, not executable locations.
function releaseView(release) {
  if (!release) return null;
  const { handlerEntry, runtime, ...rest } = release;
  const { handlers, ...options } = runtime;
  return { ...rest, ...(rest.python ? { python: pythonSourceView(rest.python) } : {}),
    ...(rest.duckdb ? { duckdb: duckdbSourceView(rest.duckdb) } : {}),
    runtime: { ...options, applicationConfigured: Boolean(handlers || runtime.upstreams || rest.python || rest.duckdb || rest.mysql || rest.s3 || rest.jsonrpc || rest.sqlite) },
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
async function originalJson(url, maximum = 16 * 1024 * 1024) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!response.ok) throw failure('SELLER_UNAVAILABLE', 'Original seller metadata returned HTTP ' + response.status + '.');
  const parts = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw failure('SELLER_METADATA_TOO_LARGE', 'Original metadata exceeds its size limit.');
    parts.push(chunk);
  }
  const bytes = Buffer.concat(parts);
  return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes };
}

export class MerchantReleaseOperator {
  #config; #managed = null; #busy = false; #closing = false; #active = Promise.resolve(); #close; #lastFailure = null; #discovery; #fleet; #accounting; #support; #receiving;
  #clientReads = new RetainedFileReads({ errorPrefix: 'CLIENT' });
  constructor(config) { this.#config = config; this.#discovery = new MerchantDiscovery(config); this.#fleet = new MerchantFleet(config.fleet); this.#accounting = new MerchantAccounting(config); this.#support = new MerchantSupport(config); this.#receiving = new MerchantReceiving(config); }
  get tools() { return structuredClone(MERCHANT_TOOLS); }
  async status() {
    const result = await releaseStatus(this.#config.releaseStore);
    return { schema: 'stellar-forge.merchant-mcp-status.v1', merchant: this.#config.name,
      state: result.state, releases: result.releases.map(releaseView), errors: result.errors,
      runtime: runtimeView(result.runtime), operator: { managesRunningSeller: Boolean(this.#managed),
        instanceId: this.#managed?.observation.instanceId ?? null, busy: this.#busy,
        closing: this.#closing, lastFailure: this.#lastFailure, discovery: this.#discovery.summary, fleet: this.#fleet.summary, accounting: this.#accounting.summary, support: this.#support.summary, receiving: this.#receiving.summary, clientExports: this.#clientReads.summary } };
  }
  #owned(instanceId) {
    if (typeof instanceId !== 'string' || !this.#managed || instanceId !== this.#managed.observation.instanceId)
      throw failure('INSTANCE_CONFLICT', 'This MCP process does not own that seller instance. Read merchant_status.');
    return this.#managed;
  }
  async #selected(args) {
    const state = await readReleaseState(this.#config.releaseStore);
    if (state.generation !== generation(args.expectedGeneration)) throw failure('RELEASE_CONFLICT', 'Selection changed. Read merchant_status and compare the current release.');
    if (!state.active) throw failure('RELEASE_NOT_SELECTED', 'Activate a staged release before starting.');
    const release = await inspectRelease(this.#config.releaseStore, state.active);
    if (release.digest !== expectedDigest(args.expectedDigest)) throw failure('RELEASE_CONFLICT', 'Selected release differs from the inspected digest.');
    return { state, release };
  }
  async #start(args) {
    await this.#selected(args);
    if (this.#managed) throw failure('RELEASE_BUSY', 'This MCP process already owns a seller. Use merchant_restart or merchant_stop.');
    const session = await runActiveRelease(this.#config.releaseStore, { expectedGeneration: args.expectedGeneration });
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
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(session.url)) throw failure('SELLER_UNAVAILABLE', 'Original seller must use its loopback listener.');
    const [health, offers, openapi] = await Promise.all(['health', 'offers', 'openapi.json'].map(name => originalJson(session.url + '/_seller/' + name)));
    if (this.#managed !== session) throw failure('INSTANCE_CONFLICT', 'Seller stopped while reading its metadata.');
    return { session, health, offers, openapi };
  }
  async #sources(source) {
    const aliases = Object.keys(this.#config.sources);
    if (source === undefined) return { merchant: this.#config.name, sources: aliases.map(alias => ({ source: alias, label: this.#config.sources[alias].label })) };
    identifier(source, 'Source alias');
    const candidate = this.#config.sources[source];
    if (!candidate) throw failure('SOURCE_NOT_FOUND', 'Choose one of the host-configured source aliases.');
    return inspectMerchantSource(candidate);
  }
  async #clientExport(name, args) {
    const exportId = identifier(args.exportId, 'Export ID'), directory = join(this.#config.exportsDirectory, exportId);
    if (name === 'merchant_client_export_status') return { ...await inspectSellerClientExport({ directory, exportId }),
      exportId, fileReads: this.#clientReads.status(exportId) };
    if (name === 'merchant_client_export_adopt') return { ...await adoptSellerClientExport({ directory,
      expectedFilesSha256: args.expectedFilesSha256, provenance: { exportId } }), exportId };
    if (name === 'merchant_client_export_manifest') {
      const { manifest, manifestFile } = await readSellerClientManifest({ directory, exportId });
      return { state: 'MANIFEST_RETAINED', exportId, manifest, manifestFile, fileReads: this.#clientReads.status(exportId) };
    }
    if (name === 'merchant_client_export_file_release') {
      if (typeof args.readId !== 'string') throw failure('INVALID_PARAMS', 'Supply the original file read ID.');
      await this.#clientReads.release(exportId, args.readId); return { exportId, readId: args.readId, released: true };
    }
    if (name === 'merchant_client_export_file') {
      if (typeof args.expectedManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedManifestSha256) ||
          ![CLIENT_EXPORT_MANIFEST, ...CLIENT_EXPORT_FILES].includes(args.file))
        throw failure('INVALID_PARAMS', 'Select the original customer file and inspected completion digest.');
      const result = await this.#clientReads.read({ scope: exportId, kind: 'client-export',
        key: JSON.stringify([exportId, args.file, args.expectedManifestSha256]), directory: this.#config.exportsDirectory,
        readId: args.readId, offset: args.offset, limit: args.limit, expectedSha256: args.expectedSha256,
        load: () => readSellerClientFile({ directory, exportId, file: args.file, expectedManifestSha256: args.expectedManifestSha256 }) });
      return { exportId, manifestSha256: args.expectedManifestSha256, ...result };
    }
    throw failure('TOOL_NOT_FOUND', 'Unknown original client export operation.');
  }
  async #execute(name, args) {
    if (name.startsWith('merchant_client_export_')) return this.#clientExport(name, args);
    if (name.startsWith('merchant_accounting_')) return this.#accounting.call(name, args);
    if (name.startsWith('merchant_receiving_')) return this.#receiving.call(name, args);
    if (name.startsWith('merchant_fleet_')) return this.#fleet.call(name, args);
    const root = this.#config.releaseStore;
    if (name.startsWith('merchant_case') || name.startsWith('merchant_incident') || name.startsWith('merchant_notification') || name.startsWith('merchant_support_'))
      return this.#support.call(name, args);
    switch (name) {
      case 'merchant_status': return this.status();
      case 'merchant_sources': return this.#sources(args.source);
      case 'merchant_operations': {
        const session = this.#owned(args.instanceId);
        return { instanceId: session.observation.instanceId, releaseId: session.release.id,
          available: Boolean(session.operations), operations: session.operations ? { ...session.operations } : null };
      }
      case 'merchant_discovery_status': return this.#discovery.status(args);
      case 'merchant_discovery_review': return this.#discovery.review(args);
      case 'merchant_discovery_apply': return this.#discovery.apply(args);
      case 'merchant_cache_status': return merchantCacheStatus(root);
      case 'merchant_cache_invalidate': this.#owned(args.instanceId); return merchantCacheInvalidate(root, args);
      case 'merchant_inspect': return releaseView(await inspectRelease(root, identifier(args.id)));
      case 'merchant_stage': {
        const alias = identifier(args.source, 'Source alias'), source = this.#config.sources[alias];
        if (!source) throw failure('SOURCE_NOT_FOUND', 'Choose one of the host-configured source aliases.');
        const release = await stageRelease(root, { ...source, id: identifier(args.id), label: line(args.label ?? args.id, 'Release label') });
        return { source: alias, release: releaseView(release) };
      }
      case 'merchant_compare': {
        const state = await readReleaseState(root), from = args.from === undefined ? state.active : args.from;
        const comparison = await compareReleases(root, from === null ? null : identifier(from), identifier(args.to));
        return { ...comparison, generation: state.generation, before: releaseView(comparison.before), after: releaseView(comparison.after),
          runtimeChanges: comparison.runtimeChanges.map(change => change.field === 'handlers'
            ? { field: 'applicationConfigured', before: Boolean(change.before), after: Boolean(change.after) }
            : change.field === 'python' ? { ...change, before: pythonSourceView(change.before), after: pythonSourceView(change.after) }
            : change.field === 'duckdb' ? { ...change, before: duckdbSourceView(change.before), after: duckdbSourceView(change.after) } : change) };
      }
      case 'merchant_activate': case 'merchant_rollback': {
        const target = identifier(name === 'merchant_activate' ? args.id : args.to);
        const release = await inspectRelease(root, target);
        if (release.digest !== expectedDigest(args.expectedDigest)) throw failure('RELEASE_CONFLICT', 'Release differs from the inspected digest.');
        const options = { expectedGeneration: generation(args.expectedGeneration), reason: line(args.reason, 'Change reason') };
        const result = name === 'merchant_activate' ? await activateRelease(root, target, options) : await rollbackRelease(root, { ...options, to: target });
        return { ...result, status: await this.status() };
      }
      case 'merchant_start': await this.#start(args); return this.status();
      case 'merchant_stop': return { stopped: await this.#stop(args.instanceId), status: await this.status() };
      case 'merchant_restart': {
        this.#owned(args.instanceId); await this.#selected(args);
        const stopped = await this.#stop(args.instanceId);
        await this.#start(args);
        return { stopped, status: await this.status() };
      }
      case 'merchant_catalog': {
        const { session, health, offers, openapi } = await this.#catalog(args.instanceId);
        return { instanceId: session.observation.instanceId, releaseId: session.release.id, releaseDigest: session.release.digest,
          health: health.value, offers: offers.value, openapi: openapi.value, openapiSha256: hash(openapi.bytes) };
      }
      case 'merchant_client_export': {
        const exportId = identifier(args.id, 'Export ID');
        const { session, openapi } = await this.#catalog(args.instanceId);
        // The original exporter owns its five payloads and completion receipt.
        const temporary = await mkdtemp(join(this.#config.exportsDirectory, '.openapi-'));
        try {
          const input = join(temporary, 'seller-openapi.json'); await writePrivate(input, openapi.bytes);
          const result = await exportSellerClient({ openapi: input, out: join(this.#config.exportsDirectory, exportId),
            provenance: { exportId, releaseId: session.release.id, releaseDigest: session.release.digest, instanceId: session.observation.instanceId } });
          return { ...result, exportId, releaseId: session.release.id, releaseDigest: session.release.digest,
            instanceId: session.observation.instanceId };
        } finally { await rm(temporary, { recursive: true, force: true }); }
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown merchant operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'Merchant operator is closing.');
    const definition = definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Unknown merchant operation.');
    exact(args, Object.keys(definition.inputSchema.properties), definition.inputSchema.required);
    if (!mutations.has(name)) return this.#execute(name, args);
    if (this.#busy) throw failure('OPERATOR_BUSY', 'Another merchant change is running. Read merchant_status before continuing.');
    this.#busy = true; this.#lastFailure = null;
    let done; this.#active = new Promise(resolve => { done = resolve; });
    try {
      const result = await this.#execute(name, args);
      this.#busy = false;
      if (result?.operator) result.operator.busy = false;
      if (result?.status?.operator) result.status.operator.busy = false;
      return result;
    }
    catch (error) { this.#lastFailure = { code: error.code ?? 'OPERATOR_ERROR', message: error.message }; throw error; }
    finally { this.#busy = false; done(); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#fleet.cancelStaging();
    this.#close = (async () => {
      await this.#active;
      const outcomes = await Promise.allSettled([this.#fleet.close(), this.#accounting.close(), this.#support.close(), this.#receiving.close(), this.#clientReads.close(),
        this.#managed ? this.#stop(this.#managed.observation.instanceId) : Promise.resolve()]);
      if (outcomes.some(result => result.status === 'rejected'))
        throw failure('OPERATOR_SHUTDOWN_INCOMPLETE', 'One or more original owned runtimes reported an incomplete shutdown.');
    })();
    return this.#close;
  }
}
export async function openMerchantOperator(configPath) {
  return new MerchantReleaseOperator(await readMerchantConfig(configPath));
}
