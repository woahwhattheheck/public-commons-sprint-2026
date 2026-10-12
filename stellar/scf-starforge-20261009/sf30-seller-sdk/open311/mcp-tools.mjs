// MIT. Original merchant tool declarations for the durable Open311 desk.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const sourceId = { type: 'string', minLength: 1, maxLength: 500 };
const revision = { type: 'integer', minimum: 0 };
const workspace = { workspace: alias };
const mutation = { ...workspace, requestId: id, expectedRevision: revision };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const read = { readOnly: true, idempotent: true };
const change = { idempotent: true };
const reviewed = {
  type: 'object', additionalProperties: false, properties: {
    status: { type: 'string', enum: ['new', 'assigned', 'in_progress', 'done'] },
    assignee: { type: 'string', maxLength: 200 },
    note: { type: 'string', maxLength: 8000 },
    dueDate: { type: 'string', pattern: '^(?:[0-9]{4}-[0-9]{2}-[0-9]{2})?$' },
  },
};
export const open311FileSelection = {
  kind: { type: 'string', enum: ['workspace', 'source', 'json', 'csv', 'report', 'comparison', 'operation'] },
  capture: id, collection: id, before: id, after: id, operationId: id, expectedRevision: revision,
  comparisonKind: { type: 'string', enum: ['capture', 'collection'] },
};
export function open311WorkspaceTools(tool) {
  return [
    tool('merchant_open311_workspaces', 'List host-selected municipal desks, complete source connection profiles and input bundle aliases.', {}, [], read),
    tool('merchant_open311_status', 'Read the current workspace identity, revision, collection counts, recent operations and retained download status.', workspace, ['workspace'], read),
    tool('merchant_open311_records', 'Page complete saved connections, capture metadata, collection summaries or internal reviews at one observed revision. Follow nextOffset.', {
      ...workspace, kind: { type: 'string', enum: ['connections', 'captures', 'collections', 'reviews'] },
      expectedRevision: revision, ...page,
    }, ['workspace', 'kind', 'expectedRevision'], read),
    tool('merchant_open311_connection_put', 'Apply a complete host-selected civic connection profile under a stable request ID and observed workspace revision.', {
      ...mutation, profile: alias,
    }, ['workspace', 'profile', 'requestId', 'expectedRevision'], change),
    tool('merchant_open311_capture', 'Read and retain a service catalog, definition, request window, specific request, token or discovery document from the selected civic source. Repeat the original request ID and inputs for recovery.', {
      ...mutation, connectionId: id,
      kind: { type: 'string', enum: ['services', 'service', 'requests', 'request', 'token', 'discovery'] },
      query: { type: 'object' }, resourceId: sourceId,
    }, ['workspace', 'connectionId', 'requestId', 'expectedRevision'], change),
    tool('merchant_open311_collection_create', 'Save a complete source collection by creation time or declared update time, with original provider filters and window or page traversal. The plan pins the endpoint, jurisdiction, cap and policy before its first capture. Inspect its members, then run it.', {
      ...mutation, connectionId: id, name: { type: 'string', minLength: 1, maxLength: 200 },
      query: { type: 'object' }, policy: { type: 'object', additionalProperties: false, properties: {
        timeBasis: { type: 'string', enum: ['created', 'updated'] },
        strategy: { type: 'string', enum: ['windows', 'pages'] },
        maxWindowDays: { type: 'integer', minimum: 1, maximum: 90 },
        queryQuantumMs: { type: 'integer', minimum: 1, maximum: 86400000 },
        minimumWindowMs: { type: 'integer', minimum: 1, maximum: 7776000000 },
        boundaryOverlapMs: { type: 'integer', minimum: 0, maximum: 3887999999 },
      } },
    }, ['workspace', 'connectionId', 'query', 'requestId', 'expectedRevision'], change),
    tool('merchant_open311_collection_run', 'Run or resume a saved collection through its original windows or declared source pages. Window traversal refines capped parents; page traversal retains full pages and follows their numbered successors until a short page. Every original remains available, including a repeated full page retained as LIMITED. Repeat the same original run intent after uncertain delivery; use a new intent for a settled interrupted or paused run.', {
      ...mutation, collectionId: id,
    }, ['workspace', 'collectionId', 'requestId', 'expectedRevision'], change),
    tool('merchant_open311_collection_pause', 'Request a durable pause after the in-flight source window is retained. This tool can run concurrently with collection_run. Observe the current revision immediately before preparing this separate pause operation.', {
      ...mutation, collectionId: id,
    }, ['workspace', 'collectionId', 'requestId', 'expectedRevision'], change),
    tool('merchant_open311_collection_info', 'Page every original collection member, its date bounds, source page, attempts, capture receipt, traversal policy and complete progress counts. Original bodies are available through each capture source file. Follow nextOffset at the selected revision.', {
      ...workspace, id, expectedRevision: revision, ...page,
    }, ['workspace', 'id', 'expectedRevision'], read),
    tool('merchant_open311_capture_info', 'Inspect retained capture metadata, query, response receipt and exact source-byte manifest. Download its complete json or source file for the original body.', {
      ...workspace, id,
    }, ['workspace', 'id'], read),
    tool('merchant_open311_services', 'Page the complete saved service catalog for one connection at the observed revision. Metadata and arbitrary original service fields remain available.', {
      ...workspace, connection: id, expectedRevision: revision, ...page,
    }, ['workspace', 'connection', 'expectedRevision'], read),
    tool('merchant_open311_requests', 'Search and page one saved capture or consolidated source collection. Source status and internal review remain separate. Collection rows expose the selected capture, version count and observation count. Follow nextOffset at the same revision.', {
      ...workspace, capture: id, collection: id, expectedRevision: revision,
      status: { type: 'string', maxLength: 1000 }, service: { type: 'string', maxLength: 1000 },
      q: { type: 'string', maxLength: 8000 }, changedOnly: { type: 'boolean' },
      reviewStatus: { type: 'string', enum: ['new', 'assigned', 'in_progress', 'done'] },
      assignee: { type: 'string', maxLength: 200 }, ...page,
      sort: { type: 'string', enum: ['requested', 'updated', 'expected', 'id', 'service', 'status'] },
      order: { type: 'string', enum: ['asc', 'desc'] },
    }, ['workspace', 'expectedRevision'], read),
    tool('merchant_open311_request', 'Read one complete saved case, every original observation, distinct source versions and internal review. Select one capture, connection or collection; the original civic ID is exact text.', {
      ...workspace, id: sourceId, capture: id, connection: id, collection: id, expectedRevision: revision,
    }, ['workspace', 'id'], read),
    tool('merchant_open311_diff', 'Compare two original captures or two complete source collections and page one change section. Absence comparisons require equal fixed, traversed scopes with resolved caps and valid source dates. Source status and internal review remain independent.', {
      ...workspace, before: id, after: id, kind: { type: 'string', enum: ['capture', 'collection'] },
      section: { type: 'string', enum: ['added', 'changed', 'unchanged', 'missingFromCapture'] }, ...page,
    }, ['workspace', 'before', 'after'], read),
    tool('merchant_open311_review_put', 'Save assignment, due date, note and internal review status for a captured case under one stable operation. The civic source status is preserved.', {
      ...mutation, connectionId: id, serviceRequestId: sourceId, review: reviewed,
      captureId: id, expectedSourceSha256: hash,
    }, ['workspace', 'connectionId', 'serviceRequestId', 'review', 'requestId', 'expectedRevision'], change),
    tool('merchant_open311_operation', 'Recover a saved operation result or source error using the original request ID. Full retained source errors are available as operation files.', {
      ...workspace, requestId: id,
    }, ['workspace', 'requestId'], read),
    tool('merchant_open311_input', 'Inspect the exact host-selected complete workspace bundle, source inventory and pinned file hash before receiving it.', {
      ...workspace, input: alias,
    }, ['workspace', 'input'], read),
    tool('merchant_open311_receive', 'Receive an entire host-selected workspace bundle, including original source bytes, captures, source collections, reviews and saved operations, into its selected empty desk. Resume paused or interrupted collection work from its original plan.', {
      ...mutation, input: alias, expectedSha256: hash,
    }, ['workspace', 'input', 'expectedSha256', 'requestId', 'expectedRevision'], change),
    tool('merchant_open311_file_read', 'Read complete original source, workspace, case export, CSV, print report, comparison or operation through retained byte chunks. Preserve the complete selection, expectedSha256 and offset for continuation.', {
      ...workspace, ...open311FileSelection, readId: { type: 'string', minLength: 1, maxLength: 128 },
      expectedSha256: hash, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind'], read),
    tool('merchant_open311_file_release', 'Release one retained file reader after delivery or explicit cancellation.', {
      ...workspace, readId: { type: 'string', minLength: 1, maxLength: 128 },
    }, ['workspace', 'readId'], change),
  ];
}
