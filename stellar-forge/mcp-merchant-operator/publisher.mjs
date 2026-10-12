import { publisherTools, read, selected, uuid, page, revision, planSchema, positive, digest, run, query, schema, policy, alias, UUID, column, names, HASH } from './catalog/publisher.mjs';
export { publisherTools } from './catalog/publisher.mjs';
// MIT. Agent authoring and maintenance through the original retained publisher.
import { createHash, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { failure, identifier, fileBytes } from './config.mjs';





















const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function hash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) throw failure('INVALID_PARAMS', 'Use the exact inspected SHA-256.');
  return value;
}
function nativeId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw failure('INVALID_PARAMS', 'Use an original lowercase UUID.');
  return value;
}
function queryText(value = '') {
  if (typeof value !== 'string' || value.length > 8192) throw failure('INVALID_PARAMS', 'Use an original dataset query string up to 8192 characters.');
  return value;
}
function databaseView(identity) {
  if (!identity) return identity;
  const { path, ...value } = identity;
  return { ...value, ...(path ? { configuredPathSha256: sha(path) } : {}) };
}
function observationView(observation) {
  if (observation?.schema !== 'stellar-forge.sheets-range-observation.v1' || !observation.capture) return observation;
  const { file, ...capture } = observation.capture;
  return { ...observation, capture };
}
function candidateView(candidate) {
  if (!candidate) return candidate;
  const extraction = candidate.extraction;
  return { ...candidate, ...(extraction ? { extraction: { ...extraction,
    ...(extraction.databaseIdentity ? { databaseIdentity: databaseView(extraction.databaseIdentity) } : {}),
    ...(extraction.observation ? { observation: observationView(extraction.observation) } : {}),
  } } : {}) };
}
function dataView(data) {
  const value = { ...data };
  if (value.candidate) value.candidate = candidateView(value.candidate);
  if (value.review) {
    const { directory, ...target } = value.review.target;
    value.review = { ...value.review, target };
  }
  if (value.publication) {
    const { result, ...publication } = value.publication;
    value.publication = publication;
  }
  if (value.path) {
    const match = /^buyer-([a-f0-9-]{36})\.json$/.exec(basename(value.path));
    if (match && UUID.test(match[1])) value.handoffId = match[1];
    delete value.path;
  }
  return value;
}
function planView(plan) {
  const { folder, ...value } = plan;
  return { ...value, data: { ...value.data,
    ...(value.data.databaseIdentity ? { databaseIdentity: databaseView(value.data.databaseIdentity) } : {}),
  } };
}
const runView = value => ({ ...value, data: dataView(value.data) });
function targetView(target) {
  const { directory, ...view } = target;
  return view;
}
function statusView(value) {
  const { directory, sourceFile, targetDirectory, ...status } = value;
  return { ...status, plans: status.plans.map(planView), runs: status.runs.map(runView),
    history: status.history.map(event => ({ ...event, data: dataView(event.data) })) };
}
function operationFailure(error) {
  if (error.path || error.syscall) return failure('PUBLISHER_STORAGE_UNAVAILABLE',
    'The original publisher storage could not complete. Inspect the retained run before another operation.');
  if (error.code === 'ERR_MODULE_NOT_FOUND') return failure('PUBLISHER_DEPENDENCY_UNAVAILABLE',
    'Install the maintained source dependency group for this declared publisher, then reopen it.');
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code ?? '') ? error.code : 'PUBLISHER_OPERATION_FAILED';
  return failure(code, 'Original publisher operation: ' + code + '. Read its saved state and current source/target before continuing.');
}

/** Only constant original driver imports are selected by a host-declared kind.
 * No module, path, connection URL, source JSON or executable is an MCP argument. */
async function originalFactory(kind) {
  if (kind === 'bls-labor') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/model.mjs')).openBlsPublisher;
  if (kind === 'census-acs') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/census-acs/publisher/model.mjs')).openCensusPublisher;
  if (kind === 'postgres') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/model.mjs')).openPostgresPublisher;
  if (kind === 'sqlite') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/publisher/model.mjs')).openSqlitePublisher;
  if (kind === 'mysql') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/publisher/model.mjs')).openMysqlPublisher;
  if (kind === 'mongodb') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/mongodb/publisher/model.mjs')).openMongoPublisher;
  if (kind === 'sheets') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/publisher/model.mjs')).openSheetsPublisher;
  if (kind === 'nocodb') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/publisher/model.mjs')).openNocoDBPublisher;
  if (kind === 'sheetbest') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheetbest/publisher/model.mjs')).openSheetBestPublisher;
  if (kind === 'sftp') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sftp/publisher/model.mjs')).openSftpPublisher;
  if (kind === 'arcgis') return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/publisher.mjs')).openArcgisPublisher;
  throw failure('PUBLISHER_KIND_INVALID', 'Choose a host-declared Census ACS, PostgreSQL, SQLite, MySQL, MongoDB, Google Sheets, Sheet Best, SFTP or ArcGIS publisher.');
}

export class MerchantPublisher {
  #config; #entries = new Map(); #opening = new Map(); #closing = false; #close;
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.publishers),
      workspaces: Object.entries(this.#config.publishers?.workspaces ?? {}).map(([publisher, value]) => {
        const entry = this.#entries.get(publisher);
        return { publisher, label: value.label, kind: value.kind,
          state: entry ? entry.closing ? 'CLOSING' : 'OPEN' : 'CLOSED',
          instanceId: entry?.instanceId ?? null, buyerConfigured: Boolean(value.seller) };
      }) };
  }
  #declared(alias) {
    identifier(alias, 'Publisher alias');
    const definition = this.#config.publishers?.workspaces[alias];
    if (!definition) throw failure('PUBLISHER_NOT_CONFIGURED', 'Choose a host-declared alias from merchant_publishers.');
    return definition;
  }
  #entry(alias) {
    this.#declared(alias);
    const entry = this.#entries.get(alias);
    if (!entry) throw failure('PUBLISHER_NOT_OPEN', 'Open this declared publisher before operating its retained workspace.');
    if (entry.closing) throw failure('PUBLISHER_CLOSING', 'This original publisher instance is closing.');
    return entry;
  }
  #view(entry, options = {}) {
    return { publisher: entry.alias, instanceId: entry.instanceId, sourceName: entry.publisher.sourceName,
      native: statusView(entry.publisher.status(options)), schedule: entry.schedule.status() };
  }
  async #open(alias) {
    this.#declared(alias);
    if (this.#closing) throw failure('PUBLISHER_CLOSING', 'The merchant publisher adapter is closing.');
    if (this.#entries.has(alias)) return this.#view(this.#entry(alias));
    if (!this.#opening.has(alias)) {
      const opening = this.#openOriginal(alias);
      this.#opening.set(alias, opening);
      opening.finally(() => { if (this.#opening.get(alias) === opening) this.#opening.delete(alias); }).catch(() => {});
    }
    await this.#opening.get(alias);
    if (this.#closing) throw failure('PUBLISHER_CLOSING', 'The merchant publisher adapter is closing.');
    return this.#view(this.#entry(alias));
  }
  async #openOriginal(alias) {
    const configured = this.#declared(alias);
    const factory = await originalFactory(configured.kind);
    const publisher = await factory({ directory: configured.directory,
      ...(configured.seller ? { seller: configured.seller, resource: configured.resource } : {}) });
    let schedule;
    try {
      const { openPostgresSchedule } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/schedule.mjs');
      schedule = await openPostgresSchedule({ publisher });
      const entry = { alias, publisher, schedule, instanceId: randomUUID(), pending: new Set(), children: new Map(), closing: null };
      this.#entries.set(alias, entry);
      if (!this.#closing) schedule.start();
      return this.#view(entry);
    } catch (error) {
      this.#entries.delete(alias);
      try { await schedule?.close(); } finally { await publisher.close(); }
      throw error;
    }
  }
  /** Borrow the same native publisher/scheduler. This host-only hook is never an MCP payload.
   * A child owns only its listeners/models/reads. Its close must not close publisher or schedule. */
  async borrow(alias, { kind, key, open } = {}) {
    const configured = this.#declared(alias);
    if (configured.kind !== kind || typeof key !== 'string' || !key || key.length > 160 || typeof open !== 'function')
      throw failure('PUBLISHER_BORROW_INVALID', 'Bind the declared native kind and one stable host child key.');
    await this.#open(alias);
    const entry = this.#entry(alias);
    let child = entry.children.get(key);
    if (!child) {
      child = { key, pending: new Set(), closing: null, resource: null, ready: null, lease: null };
      entry.children.set(key, child);
      child.ready = Promise.resolve().then(() => open({ publisher: entry.publisher, schedule: entry.schedule,
        instanceId: entry.instanceId })).then(resource => {
        if (!resource || typeof resource.close !== 'function')
          throw failure('PUBLISHER_BORROW_INVALID', 'The owned child must provide its native close operation.');
        child.resource = resource; return resource;
      }).catch(error => { if (entry.children.get(key) === child) entry.children.delete(key); throw error; });
      const owner = this;
      child.lease = Object.freeze({
        publisher: entry.publisher, schedule: entry.schedule, instanceId: entry.instanceId,
        get resource() { return child.resource; },
        get closed() { return Boolean(child.closing || entry.closing || owner.#closing); },
        run(action) {
          if (typeof action !== 'function') throw failure('PUBLISHER_BORROW_INVALID', 'A host operation is required.');
          if (owner.#closing || owner.#entry(alias) !== entry || child.closing)
            throw failure('PUBLISHER_CLOSING', 'This original publisher child is closing.');
          const operation = Promise.resolve().then(() => action(child.resource));
          child.pending.add(operation); entry.pending.add(operation);
          return operation.finally(() => { child.pending.delete(operation); entry.pending.delete(operation); });
        },
        release: () => owner.#closeChild(entry, child),
      });
    }
    await child.ready;
    if (this.#closing || this.#entry(alias) !== entry || child.closing)
      throw failure('PUBLISHER_CLOSING', 'This original publisher child is closing.');
    return child.lease;
  }
  #closeChild(entry, child) {
    if (!child.closing) child.closing = (async () => {
      try {
        let resource;
        try { resource = await child.ready; } catch { return; }
        await Promise.allSettled([...child.pending]);
        await resource.close();
      } finally { if (entry.children.get(child.key) === child) entry.children.delete(child.key); }
    })();
    return child.closing;
  }
  async #stop(entry) {
    if (!entry.closing) {
      entry.closing = (async () => {
        // Stop new schedules and close each borrowed lifetime before releasing the core lease.
        const scheduling = (async () => entry.schedule.close())();
        const children = [...entry.children.values()].map(child => this.#closeChild(entry, child));
        let failed;
        try {
          const results = await Promise.allSettled([scheduling, ...children, ...entry.pending]);
          failed = results.find(result => result.status === 'rejected');
        } finally {
          await entry.publisher.close();
          if (this.#entries.get(entry.alias) === entry) this.#entries.delete(entry.alias);
        }
        if (failed) throw failed.reason;
        return { publisher: entry.alias, instanceId: entry.instanceId, state: 'CLOSED' };
      })();
    }
    return entry.closing;
  }
  async #handoff(entry, runId, handoffId) {
    nativeId(runId); nativeId(handoffId); entry.publisher.run(runId);
    const path = join(entry.publisher.directory, 'runs', runId, 'buyer-' + handoffId + '.json');
    let offset = 0, recorded;
    // The original event log is the authority. Read its existing pages instead
    // of adding another result registry or accepting an arbitrary filesystem path.
    do {
      const status = entry.publisher.status({ limit: 100, historyOffset: offset });
      recorded = status.history.find(event => event.kind === 'BUYER_HANDOFF_PREPARED' &&
        event.run === runId && event.data.path === path);
      offset = status.pages.history.next;
    } while (!recorded && offset !== null);
    if (!recorded) throw failure('BUYER_HANDOFF_NOT_FOUND', 'Choose a handoff UUID recorded in this original run history.');
    const bytes = await fileBytes(path, 65536);
    if (sha(bytes) !== recorded.data.configSha256) throw failure('BUYER_HANDOFF_CHANGED', 'The retained buyer file differs from its original preparation.');
    const configText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { publisher: entry.alias, runId, handoffId, eventId: recorded.id,
      preparedAt: recorded.created, snapshot: recorded.data.snapshot,
      offerSha256: recorded.data.offerSha256, configSha256: recorded.data.configSha256,
      intentId: recorded.data.intentId, config: JSON.parse(configText), configText };
  }
  async #execute(entry, name, args) {
    const original = entry.publisher, schedule = entry.schedule;
    const { publisher, ...input } = args;
    switch (name) {
      case 'merchant_publisher_status': return this.#view(entry, input);
      case 'merchant_publisher_source': return { publisher, sourceName: original.sourceName, ...await original.source() };
      case 'merchant_publisher_target': return { publisher, ...targetView(await original.target()) };
      case 'merchant_publisher_plan_save': return planView(await original.savePlan(args.plan));
      case 'merchant_publisher_extract': {
        nativeId(args.runId); hash(args.planDigest);
        const plan = original.plan(args.planId);
        if (plan.data.digest !== args.planDigest) throw failure('PLAN_REVIEW_CHANGED', 'Use the exact saved plan digest.');
        let prior;
        try { prior = original.run(args.runId); } catch (error) { if (error.code !== 'RUN_NOT_FOUND') throw error; }
        if (prior) {
          if (prior.plan !== args.planId || prior.data.planDigest !== args.planDigest)
            throw failure('EXTRACTION_ID_CONFLICT', 'This native UUID belongs to a different saved plan.');
          return { run: runView(prior), replayed: true };
        }
        const operation = original.startExtraction(args.planId, { id: args.runId });
        operation.completion.catch(() => {});
        return { run: runView(original.run(operation.id)), replayed: false };
      }
      case 'merchant_publisher_inspect': {
        const result = await original.inspect(nativeId(args.runId), args.query === undefined ? undefined : queryText(args.query));
        return { ...result, run: runView(result.run), plan: planView(result.plan) };
      }
      case 'merchant_publisher_cancel': return original.cancel(nativeId(args.runId));
      case 'merchant_publisher_review': {
        const candidate = await original.candidate(nativeId(args.runId));
        if (candidate.manifest.candidateDigest !== hash(args.candidateDigest))
          throw failure('CANDIDATE_REVIEW_CHANGED', 'Use the exact inspected candidate digest.');
        if (args.initialize !== undefined && typeof args.initialize !== 'boolean') throw failure('INVALID_PARAMS', 'initialize must be a boolean.');
        const { runId, candidateDigest, ...review } = input;
        return runView(await original.review(runId, review));
      }
      case 'merchant_publisher_publish': return runView(await original.publish(nativeId(args.runId), nativeId(args.reviewId)));
      case 'merchant_publisher_recover': {
        const value = await original.recover(nativeId(args.runId));
        return { ...runView(value), ...(value.observed ? { observed: targetView(value.observed) } : {}) };
      }
      case 'merchant_publisher_buyer_offer': return original.buyerOffer(nativeId(args.runId), queryText(args.query));
      case 'merchant_publisher_buyer_prepare': {
        nativeId(args.runId); hash(args.offerSha256);
        const { runId, ...choice } = input;
        choice.query = queryText(choice.query);
        const result = await original.prepareBuyer(runId, choice);
        const match = /^buyer-([a-f0-9-]{36})\.json$/.exec(basename(result.path));
        if (!match || !UUID.test(match[1])) throw failure('BUYER_HANDOFF_INVALID', 'The original publisher returned an unexpected handoff identity.');
        return { ...await this.#handoff(entry, runId, match[1]), mode: result.mode, sellerMode: result.sellerMode };
      }
      case 'merchant_publisher_buyer_read': return this.#handoff(entry, args.runId, args.handoffId);
      case 'merchant_publisher_schedule': return schedule.status(input);
      case 'merchant_publisher_schedule_save': return schedule.configure(args.policy);
      case 'merchant_publisher_schedule_enable': return schedule.enable(input);
      case 'merchant_publisher_schedule_pause': return schedule.pause(input);
      case 'merchant_publisher_schedule_run': {
        nativeId(args.requestId);
        const operation = schedule.runNow(input); operation.completion.catch(() => {});
        return { occurrenceId: operation.id, schedule: schedule.status() };
      }
      case 'merchant_publisher_schedule_continue': {
        const operation = schedule.continueRun(input); operation.completion.catch(() => {});
        return { occurrenceId: operation.id, schedule: schedule.status() };
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown publisher operation.');
    }
  }
  async call(name, args) {
    if (this.#closing) throw failure('PUBLISHER_CLOSING', 'The merchant publisher adapter is closing.');
    try {
      if (name === 'merchant_publishers') return this.summary;
      if (name === 'merchant_publisher_open') return await this.#open(args.publisher);
      const entry = this.#entry(args.publisher);
      if (name === 'merchant_publisher_close') {
        if (nativeId(args.instanceId) !== entry.instanceId) throw failure('INSTANCE_CONFLICT', 'Use this process-owned publisher instance from status.');
        return await this.#stop(entry);
      }
      const operation = Promise.resolve().then(() => this.#execute(entry, name, args));
      entry.pending.add(operation);
      try { return await operation; } finally { entry.pending.delete(operation); }
    } catch (error) { throw operationFailure(error); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = (async () => {
      await Promise.allSettled([...this.#opening.values()]);
      const outcomes = await Promise.allSettled([...this.#entries.values()].map(entry => this.#stop(entry)));
      if (outcomes.some(result => result.status === 'rejected'))
        throw failure('PUBLISHER_SHUTDOWN_INCOMPLETE', 'An original publisher reported incomplete shutdown; inspect its retained workspace.');
    })();
    return this.#close;
  }
}
