// MIT. Original tool metadata; provider runtimes load only when selected.


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

function publisherTools(tool) {
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

export { publisherTools, read, selected, uuid, page, revision, planSchema, positive, digest, run, query, schema, policy, alias, UUID, column, names, HASH };
