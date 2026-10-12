// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const REQUEST = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const digest = { type: 'string', pattern: SHA256.source };

const request = { type: 'string', pattern: REQUEST.source };

const uuid = { type: 'string', pattern: UUID.source };

const selected = { workspace: alias };

const inRevision = { ...selected, revisionId: digest };

const inOperation = { ...selected, requestId: request };

const read = { readOnly: true, idempotent: true };

const note = { type: 'string', maxLength: 2000 };

const pageSize = { type: 'integer', minimum: 1, maximum: 100 };

const revisionInput = { ...selected, requestId: request, expectedHead: digest,
  queries: { type: 'object' }, plan: { type: 'object' }, note };

function redisWorkspaceTools(tool) {
  return [
    tool('merchant_redis_workspaces', 'List configured original Redis workspace aliases, immutable workspace/profile identities, owned browser sessions and the workspace bound to merchant release controls. Opens no source connection.', {}, [], read),
    tool('merchant_redis_open', 'Open the existing original Redis authoring model and its browser on one process-owned writer lease. Reopening this alias returns the same browser and instance. Uses the imported host environment references.', selected, ['workspace'], { idempotent: true }),
    tool('merchant_redis_close', 'Drain this exact owned Redis workspace instance, its original browser and retained file reads. Saved revisions, original operations, packages and releases stay available for reopening.', { ...selected, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_redis_status', 'Inspect the original saved head, source profile, paged revision and operation summaries, browser URL and owned file reads. Large current revisions are available through the returned complete-record descriptor.', selected, ['workspace'], read),
    tool('merchant_redis_review', 'Compile proposed queries and merchant plan with the original Redis product compiler. Returns every normalized route and payment offer. The imported source connection stays fixed.', { ...selected, queries: { type: 'object' }, plan: { type: 'object' } }, ['workspace', 'queries', 'plan'], read),
    tool('merchant_redis_save', 'Save reviewed queries and plan to the original revision history using requestId and expectedHead. Repeating the same request reopens its retained result. Read status and reconcile browser edits when the head changes.', revisionInput, ['workspace', 'requestId', 'expectedHead', 'queries', 'plan'], { idempotent: true }),
    tool('merchant_redis_restore', 'Restore a saved revision as a new original revision using the current expectedHead. Keeps all intervening saved revisions and records this exact request.', { ...inRevision, requestId: request, expectedHead: digest, note }, ['workspace', 'requestId', 'expectedHead', 'revisionId'], { idempotent: true }),
    tool('merchant_redis_revisions', 'Page original saved revision summaries. Pass nextCursor unchanged as after. Read a revision for the complete saved source and merchant plan.', { ...selected, after: digest, limit: pageSize }, ['workspace'], read),
    tool('merchant_redis_revision', 'Read a complete original saved source revision and merchant plan. Large records return their exact byte count, SHA256 and resumable file-read selection.', inRevision, ['workspace', 'revisionId'], read),
    tool('merchant_redis_preview', 'Execute a saved declared query through the original Redis or Upstash source and retain the complete result. Supply a new requestId for each new observation. Continue a paginated result with its exact native nextInput and a new requestId.', { ...inRevision, requestId: request, query: { type: 'string', minLength: 1, maxLength: 80 }, input: { type: 'object' } }, ['workspace', 'requestId', 'revisionId', 'query', 'input'], { idempotent: true, openWorld: true }),
    tool('merchant_redis_prepare', 'Prepare or recover the original merchant package and generated customer files for one saved revision. Repeating the same request preserves its original package and retained outcome.', { ...inRevision, requestId: request }, ['workspace', 'requestId', 'revisionId'], { idempotent: true }),
    tool('merchant_redis_stage', 'Stage a completed original Redis package into this MCP merchant same release store. Use merchant_inspect, merchant_activate and the maintained merchant lifecycle for that release. runtime is selected by the host connection.', { ...selected, requestId: request, packageId: request, releaseId: alias, label: { type: 'string', maxLength: 240 } }, ['workspace', 'requestId', 'packageId', 'releaseId'], { idempotent: true }),
    tool('merchant_redis_operations', 'Page retained original operation summaries and recovery state. Pass nextCursor unchanged as after; read any original operation for its complete input, outcome and source observation.', { ...selected, after: request, limit: pageSize }, ['workspace'], read),
    tool('merchant_redis_operation', 'Read the retained original request and result after completion, interruption or a lost tool reply. Large records keep all result rows and native nextInput in the SHA256-pinned complete-record download.', inOperation, ['workspace', 'requestId'], read),
    tool('merchant_redis_resume', 'Resume this original request only when the native model marks it INTERRUPTED. Reopens other retained states without redispatch. Input and operation identity come from the original saved request.', inOperation, ['workspace', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_redis_file_read', 'Read complete saved revision/operation JSON or a verified original public customer file as resumable SHA256-pinned base64 chunks. revision uses revisionId; operation uses requestId; customer uses packageId and the exact original public filename. Continue with readId, expectedSha256 and nextOffset. After expiry/close/restart omit readId and resume the same selection, SHA256 and offset.', {
      ...selected, kind: { type: 'string', enum: ['revision', 'operation', 'customer'] }, revisionId: digest,
      requestId: request, packageId: request, name: { type: 'string', minLength: 1, maxLength: 240 },
      readId: uuid, expectedSha256: digest, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind'], read),
    tool('merchant_redis_file_release', 'Release one owned temporary verified read snapshot. The original saved record or public customer file remains available.', { ...selected, readId: uuid }, ['workspace', 'readId'], read),
  ];
}

export { redisWorkspaceTools, read, selected, uuid, revisionInput, inRevision, request, digest, note, pageSize, alias, inOperation, UUID, REQUEST, SHA256 };
