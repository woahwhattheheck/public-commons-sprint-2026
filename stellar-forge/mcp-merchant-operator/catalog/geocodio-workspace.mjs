// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const text = { type: 'string', minLength: 1, maxLength: 200 };

const object = { type: 'object', additionalProperties: true };

const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };

const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };

const read = { readOnly: true, idempotent: true };

const publisherActions = new Set([
  'publisher.status', 'publisher.prepare', 'publisher.preview', 'publisher.reviewDraft', 'publisher.publish',
  'publisher.activateSnapshot', 'publisher.collect', 'publisher.release.stage', 'publisher.release.inspect',
  'publisher.release.activate', 'publisher.release.rollback', 'publisher.release.start', 'publisher.release.stop',
  'publisher.buyer.review', 'publisher.buyer.prepare', 'publisher.buyer.session', 'publisher.buyer.run',
  'publisher.buyer.recover', 'publisher.buyer.account', 'publisher.buyer.export'
]);

function geocodioWorkspaceTools(tool) {
  const revision = { type: 'integer', minimum: 0 };
  const scoped = properties => ({ workspace: alias, ...properties });
  const chunk = { expectedSha256: hash, readId: uuid, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  return [
    tool('merchant_geocodio_status', 'List declared address/customer workspaces or read an opened original workspace. Addresses, responses, requests, editions, exports and duplicate groups have explicit history offsets. Provider credentials are represented only by a configured flag.',
      scoped({ offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), [], read),
    tool('merchant_geocodio_open', 'Open the original host-declared address operator under its existing writer lease. Repeated open reuses this instance; provider requests and the dataset publisher start only through their explicit actions.',
      scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_geocodio_close', 'Close this process-owned address operator after its accepted operations and borrowed browser drain. Original sources, requests, review decisions, editions and customer sessions remain retained.',
      scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_geocodio_intake', 'Import a host-declared exact CSV, JSON/SimplyRETS response, or retained address intake. The original parser preserves numeric identifier text, all source rows and exact address-query bindings. Optional mapping uses the native source mapping schema.',
      scoped({ sourceImport: alias, expectedRevision: revision, mapping: object, operationId: text }),
      ['workspace', 'sourceImport', 'expectedRevision']),
    tool('merchant_geocodio_provider', 'Prepare, inspect, run or import an original Geocodio request. Prepare requires maximumLookups (1–10000); the saved request retains its exact lookup count and body SHA-256. Run requires id, expectedRequestSha256 and expectedRevision, and contacts the actual provider using the host environment key. Import selects a host-declared original response and request binding. Request reads paginate the original keyed body; merchant_geocodio_file reads its exact bytes. The native operator records SENDING before HTTP and retains uncertain/provider outcomes for reconciliation.',
      scoped({ action: { enum: ['prepare', 'request', 'run', 'import'] }, payload: object }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_geocodio_policy', 'Save the original visible match-review thresholds for accuracy, accuracy type, competing candidates, stable keys, country and source-coordinate displacement. Qualification remains separate from an explicit recorded address decision.',
      scoped({ expectedRevision: revision, policy: object }), ['workspace', 'expectedRevision', 'policy']),
    tool('merchant_geocodio_review', 'List or inspect original address candidates and source records, record an explicit candidate/coordinate decision, or apply the exact displayed qualified selection. Mutation payloads require expectedRevision and a reason; the original decision history and original coordinates remain retained.',
      scoped({ action: { enum: ['list', 'query', 'decide', 'acceptQualified'] }, payload: object }), ['workspace', 'action']),
    tool('merchant_geocodio_edition', 'Build a native dataset from all original source rows or reviewed rows and selected source fields, or activate an original retained edition. Both actions require expectedRevision. Uses the maintained SF30 CSV/query engine and source-specific review basis.',
      scoped({ action: { enum: ['build', 'activate'] }, payload: object }), ['workspace', 'action']),
    tool('merchant_geocodio_query', 'Run the selected original native dataset query, projection, sort and snapshot-bound cursor. expectedRevision binds the saved query update to the current address workspace.',
      scoped({ expectedRevision: revision, query: object }), ['workspace', 'expectedRevision', 'query']),
    tool('merchant_geocodio_merchant', 'Prepare the original selected dataset with a host-declared public merchant payment profile using the native seller compiler.',
      scoped({ profile: alias, expectedRevision: revision }), ['workspace', 'profile', 'expectedRevision']),
    tool('merchant_geocodio_export', 'Create the original complete portable workspace and customer-ready native dataset, source/review/query files, exact original raw closure, and configured seller. Uses the original Geocodio source schema and sourceFiles descriptors.',
      scoped({ expectedRevision: revision }), ['workspace', 'expectedRevision']),
    tool('merchant_geocodio_restore', 'Restore a declared complete portable package into an empty original address workspace. The native importer checks retained file bytes and rebuilds every original dataset snapshot before accepting it.',
      scoped({ sourceImport: alias, expectedRevision: revision }), ['workspace', 'sourceImport', 'expectedRevision']),
    tool('merchant_geocodio_file', 'Read an exact source export, prepared provider request, or original publisher customer file in verified retained chunks. Continue with readId, expectedSha256 and nextOffset. EOF releases the cached snapshot; partial reads can be explicitly released.',
      scoped({ kind: { enum: ['source-export', 'provider-request', 'draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'] },
        id: text, filename: { type: 'string', maxLength: 500 }, ...chunk }), ['workspace', 'kind', 'id'], read),
    tool('merchant_geocodio_file_release', 'Release an unfinished process-owned retained file read while keeping the original file available.',
      scoped({ readId: uuid }), ['workspace', 'readId'], { idempotent: true }),
    tool('merchant_geocodio_publisher', 'Use all 20 original dataset publisher, SF82 release and SF88 customer actions. Prepare chooses this address workspace exportId; staging uses host runtime configuration; buyer session creation chooses a host buyerWorkspace. Native draft/release generations, approvals, original ledger and page attempts remain authoritative. Explicit unpaid continuation passes retryUnpaid and expectedAttemptSha256 through publisher.buyer.run.',
      scoped({ action: { enum: [...publisherActions] }, payload: object }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_geocodio_browser', 'Open or close an industrial browser on this exact original operator and its lazy publisher. The returned private local URL is for this process. Closing a borrowed browser leaves the MCP-owned address workspace open.',
      scoped({ action: { enum: ['open', 'close'] }, port: { type: 'integer', minimum: 0, maximum: 65535 } }), ['workspace', 'action']),
  ];
}

export { geocodioWorkspaceTools, alias, hash, uuid, read, object, text, publisherActions };
