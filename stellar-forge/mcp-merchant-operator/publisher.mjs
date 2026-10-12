// MIT. Agent authoring and maintenance through the original retained publisher.
import { createHash, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { failure, identifier, fileBytes } from './config.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', pattern: UUID.source };
const digest = { type: 'string', pattern: HASH.source };
const revision = { type: 'integer', minimum: 0 };
const positive = { type: 'integer', minimum: 1 };
const query = { type: 'string', maxLength: 8192 };
const selected = { publisher: alias };
const run = { ...selected, runId: uuid };
const read = { readOnly: true, idempotent: true };
const page = { limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: revision };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const names = { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true };
const column = { anyOf: [
  { enum: ['string', 'integer', 'number', 'boolean'] },
  schema({ type: { enum: ['string', 'integer', 'number', 'boolean'] }, nullable: { type: 'boolean' } }, ['type']),
] };
const planSchema = schema({
  title: { type: 'string', minLength: 1, maxLength: 128 }, query: { type: 'string', minLength: 1 },
  sourceHash: digest, input: { type: 'object' },
  dataset: schema({
    name: { type: 'string', minLength: 1 },
    columns: { type: 'object', minProperties: 1, additionalProperties: column },
    filters: names, ranges: names, sorts: names, maxCellChars: positive,
    defaultLimit: positive, maxLimit: positive, maxPageBytes: positive,
  }, ['name', 'columns']),
  extraction: schema({
    maxRows: positive, maxBytes: positive, maxRowBytes: positive, timeoutMs: positive,
    order: { type: 'array', minItems: 1, items: schema({
      column: { type: 'string', minLength: 1 }, direction: { enum: ['asc', 'desc'] },
    }, ['column', 'direction']) },
  }, ['order']),
}, ['title', 'query', 'sourceHash', 'dataset', 'extraction']);
const policy = {
  revision, referenceRun: uuid, planDigest: digest, expectedSnapshot: digest, expectedRevision: revision,
  intervalSeconds: { type: 'integer', minimum: 30, maximum: 2592000 },
  minimumRows: revision, maximumRows: positive,
  maximumDropPercent: { anyOf: [{ type: 'integer', minimum: 0, maximum: 100 }, { type: 'null' }] },
  onError: { enum: ['pause', 'next-interval'] },
  reviewer: { type: 'string', minLength: 1, maxLength: 80 },
  note: { type: 'string', minLength: 1, maxLength: 1200 },
};

export function publisherTools(tool) {
  return [
    tool('merchant_publishers', 'List host-declared retained PostgreSQL/SQLite/MySQL/MongoDB/Google Sheets/Sheet Best/NocoDB/SFTP/ArcGIS publisher aliases, including Census ACS, and process ownership. Does not open a workspace, start a timer or query a source.', {}, [], read),
    tool('merchant_publisher_open', 'Open the original retained publisher and its single native scheduler under the original workspace lease. Previously enabled refreshes resume as in the original browser server. An already-open alias returns the same instance.', selected, ['publisher'], { idempotent: true, openWorld: true }),
    tool('merchant_publisher_close', 'Close this exact process-owned publisher instance. Original scheduler stops future intervals, original active work drains or cancels through its existing close method, and the workspace lease is released. Saved policy and operations remain.', { ...selected, instanceId: uuid }, ['publisher', 'instanceId'], { destructive: true }),
    tool('merchant_publisher_status', 'Read native saved plans, extraction runs, events and active progress, with original pagination. Local source paths are omitted; native hashes and identities are unchanged. Open the alias first.', {
      ...selected, limit: page.limit, plansOffset: revision, runsOffset: revision, historyOffset: revision,
    }, ['publisher'], read),
    tool('merchant_publisher_source', 'Inspect the original configured source hash, approved named source definitions, public projections and parameter schemas. MongoDB retains its collection/pipeline/read concern; Sheets retains its range/type/formula bindings; Sheet Best retains its selected connection/tab/value mode and complete records response; NocoDB retains exact v3 table/view/field IDs, complete page/count observations and explicit scalar encodings; SFTP retains the pinned host, file path, format, pointers and typed comparisons. Reads the declaration without querying the provider or returning credentials.', selected, ['publisher'], read),
    tool('merchant_publisher_target', 'Read the original versioned seller control schema, current snapshot/revision, retained versions and public resources. Uses only the existing host-bound private control connection.', selected, ['publisher'], read),
    tool('merchant_publisher_plan_save', 'Save an original immutable extraction plan using the inspected sourceHash, approved query and source-specific input (empty for Sheets), explicit public column mapping and extraction limits/order. The original driver retains and validates its own source. After a lost reply inspect native plans before saving again.', { ...selected, plan: planSchema }, ['publisher', 'plan']),
    tool('merchant_publisher_extract', 'Start the original read-only extraction with an explicit native run UUID and exact saved plan digest. Returns immediately; inspect this same run to follow progress. Repeating the same UUID/plan returns its retained run without another query.', {
      ...selected, planId: positive, planDigest: digest, runId: uuid,
    }, ['publisher', 'planId', 'planDigest', 'runId'], { idempotent: true, openWorld: true }),
    tool('merchant_publisher_inspect', 'Read a retained native run and its original typed candidate preview, including exact decimal/text/Boolean/null values. Optional query selects a page through the original dataset parser. No source query or publication occurs.', { ...run, query }, ['publisher', 'runId'], read),
    tool('merchant_publisher_cancel', 'Request cancellation of this exact active native extraction. Read its retained run for the final original cancellation outcome.', run, ['publisher', 'runId'], { destructive: true }),
    tool('merchant_publisher_review', 'Record a responsible reviewer and note for the exact inspected candidate digest. Refresh binds the current snapshot and revision; initialize:true selects only the original absent target. Returns the original review UUID required for publication.', {
      ...run, candidateDigest: digest, reviewer: { type: 'string', minLength: 1, maxLength: 128 },
      note: { type: 'string', minLength: 1, maxLength: 2000 }, initialize: { type: 'boolean' },
      expectedSnapshot: digest, expectedRevision: revision,
    }, ['publisher', 'runId', 'candidateDigest', 'reviewer', 'note']),
    tool('merchant_publisher_publish', 'Publish using the original run and exact current review UUID. Native expected-revision, retained-generation and capacity rules govern the result. Inspect or recover an uncertain result before another explicit publication.', { ...run, reviewId: uuid }, ['publisher', 'runId', 'reviewId'], { openWorld: true }),
    tool('merchant_publisher_recover', 'Reconcile this original retained extraction/candidate against the actual target after interruption. Uses the original recovery operation and does not launch another query or blindly retry publication.', run, ['publisher', 'runId']),
    tool('merchant_publisher_buyer_offer', 'Read the original running seller offer for this exact candidate snapshot and first-page query. Returns all advertised payment alternatives and offerSha256 for review. Does not request a paid resource.', { ...run, query }, ['publisher', 'runId'], read),
    tool('merchant_publisher_buyer_prepare', 'Prepare and retain the original SF88 buyer configuration for the reviewed offer, acceptIndex and unique intentId. Returns its exact configText and original handoff UUID. No signing, payment or buyer execution occurs.', {
      ...run, query, offerSha256: digest, acceptIndex: revision,
      intentId: { type: 'string', minLength: 1, maxLength: 160 },
    }, ['publisher', 'runId', 'offerSha256', 'acceptIndex', 'intentId']),
    tool('merchant_publisher_buyer_read', 'Reopen the original saved buyer handoff by native run/handoff UUID. Checks its bytes against the original publisher event digest and returns the exact configuration without another offer read, preparation or payment.', {
      ...run, handoffId: uuid,
    }, ['publisher', 'runId', 'handoffId'], read),
    tool('merchant_publisher_schedule', 'Read the original saved publication policy, control revision and occurrence history. Original pending run/candidate identities survive restart. This read does not start a timer.', { ...selected, ...page }, ['publisher'], read),
    tool('merchant_publisher_schedule_save', 'Save the original recurring-publication policy against a currently published baseline, exact plan digest and current target snapshot/revision. Policy includes cadence, row bounds, error behavior and responsible operator; it is saved paused.', {
      ...selected, policy: schema(policy, Object.keys(policy)),
    }, ['publisher', 'policy']),
    tool('merchant_publisher_schedule_enable', 'Enable the saved original policy after checking the current control revision and exact target snapshot/revision. Future refreshes use its retained approved query and publication limits.', {
      ...selected, revision, expectedSnapshot: digest, expectedRevision: revision,
    }, ['publisher', 'revision', 'expectedSnapshot', 'expectedRevision']),
    tool('merchant_publisher_schedule_pause', 'Pause future refresh intervals using the current control revision. An already accepted refresh drains through the original publisher; pause does not cancel or reverse that publication.', { ...selected, revision }, ['publisher', 'revision']),
    tool('merchant_publisher_schedule_run', 'Run the saved original publication policy once using an explicit request UUID. Returns its same native occurrence/run immediately; repeated UUIDs retain the original operation. Inspect the schedule for completion.', {
      ...selected, revision, requestId: uuid,
    }, ['publisher', 'revision', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_publisher_schedule_continue', 'Explicitly continue the original pending occurrence using the current control revision. Native recovery checks its retained candidate and actual target before deciding whether publication can continue.', {
      ...selected, revision,
    }, ['publisher', 'revision'], { openWorld: true }),
  ];
}

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
  #config; #entries = new Map(); #closing = false; #close;
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
    const configured = this.#declared(alias), existing = this.#entries.get(alias);
    if (existing) return this.#view(this.#entry(alias));
    const factory = await originalFactory(configured.kind);
    const publisher = await factory({ directory: configured.directory,
      ...(configured.seller ? { seller: configured.seller, resource: configured.resource } : {}) });
    let schedule;
    try {
      const { openPostgresSchedule } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/schedule.mjs');
      schedule = await openPostgresSchedule({ publisher });
      const entry = { alias, publisher, schedule, instanceId: randomUUID(), pending: new Set(), closing: null };
      this.#entries.set(alias, entry);
      schedule.start();
      return this.#view(entry);
    } catch (error) {
      this.#entries.delete(alias);
      try { await schedule?.close(); } finally { await publisher.close(); }
      throw error;
    }
  }
  async #stop(entry) {
    if (!entry.closing) {
      entry.closing = (async () => {
        // Stop future native intervals immediately while already accepted
        // reads and the original scheduler's current operation drain.
        const scheduleClosing = (async () => entry.schedule.close())();
        try {
          const [scheduled] = await Promise.allSettled([scheduleClosing, ...entry.pending]);
          if (scheduled.status === 'rejected') throw scheduled.reason;
        } finally { await entry.publisher.close(); }
        if (this.#entries.get(entry.alias) === entry) this.#entries.delete(entry.alias);
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
      const outcomes = await Promise.allSettled([...this.#entries.values()].map(entry => this.#stop(entry)));
      if (outcomes.some(result => result.status === 'rejected'))
        throw failure('PUBLISHER_SHUTDOWN_INCOMPLETE', 'An original publisher reported incomplete shutdown; inspect its retained workspace.');
    })();
    return this.#close;
  }
}
