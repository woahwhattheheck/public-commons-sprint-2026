// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const SHA256 = /^[a-f0-9]{64}$/;

const INTENT = /^[A-Za-z0-9._:-]{1,128}$/;

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const uuid = { type: 'string', pattern: UUID.source };

const digest = { type: 'string', pattern: SHA256.source };

const shortText = { type: 'string', minLength: 1, maxLength: 128 };

const field = { type: 'string', minLength: 1, maxLength: 512 };

const columnName = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,47}$' };

const offset = { type: 'integer', minimum: 0 };

const positive = { type: 'integer', minimum: 1 };

const selected = { workspace: alias };

const changing = { ...selected, expectedOperationId: { type: ['string', 'null'], pattern: UUID.source } };

const changed = ['workspace', 'expectedOperationId'];

const read = { readOnly: true, idempotent: true };

const mutation = { idempotent: false };

const fields = { type: 'array', maxItems: 64, uniqueItems: true, items: columnName };

const fileSelection = { ...selected, kind: { type: 'string', enum: ['source', 'merchant', 'buyer'] }, itemId: uuid };

const projection = { type: 'object', minProperties: 1, maxProperties: 64,
  propertyNames: columnName, additionalProperties: { type: 'object', additionalProperties: false,
    properties: { field, type: { type: 'string', enum: ['string', 'integer', 'number', 'boolean'] },
      nullable: { type: 'boolean' }, encoding: { type: 'string', enum: ['native', 'text', 'json'] } },
    required: ['field', 'type', 'nullable', 'encoding'] } };

const definitions = [
  ['merchant_ckan_workspaces', 'List host-declared original CKAN project aliases, browser ownership, configured inputs and merchant/buyer availability. Does not open a project or read a catalogue.', {}, [], read],
  ['merchant_ckan_open', 'Open one existing CKAN project under its original lease and serve the same browser on loopback. Browser and agent actions share the original model. Reuse the returned current instanceId; close a separately running workbench first.', selected, ['workspace'], { idempotent: true }],
  ['merchant_ckan_close', 'Close this exact owned CKAN browser/model instance, drain pending calls and native operation, close retained file reads, and release its original project lease. Saved editions, publisher state and merchant packages remain available on reopen.', { ...selected, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true, idempotent: false }],
  ['merchant_ckan_status', 'Read the original current operation, active operation ID, retained project item pages and current loopback browser. Before a changing tool, use native.operation?.id ?? null as expectedOperationId. A resolved operation may be FAILED or CANCELLED: inspect its state and error. Each collection has its own offset and nextOffset.', {
    ...selected, editionsOffset: offset, sourcesOffset: offset, publicationsOffset: offset,
    exportsOffset: offset, buyerRequestsOffset: offset, limit: { type: 'integer', minimum: 1, maximum: 100 },
  }, ['workspace'], read],
  ['merchant_ckan_search', 'Search the original project catalogue through CKAN package_search and return the original provider receipt and dataset/resource metadata page. Continue with page.next; catalogue reads use only the original configured credential reference.', {
    ...selected, q: { type: 'string', maxLength: 2048 }, start: { type: 'integer', minimum: 0, maximum: 10000000 },
    rows: { type: 'integer', minimum: 1, maximum: 100 },
  }, ['workspace'], { readOnly: true, openWorld: true }],
  ['merchant_ckan_package', 'Read one original CKAN package and its resources through the project catalogue, retaining the provider receipt. Public metadata field names and exact numeric tokens remain visible.', {
    ...selected, packageId: field,
  }, ['workspace', 'packageId'], { readOnly: true, openWorld: true }],
  ['merchant_ckan_inputs', 'List host-declared original capture input aliases, or inspect one complete private capture manifest file and return its exact current bytes and SHA256. The original importer validates its retained sibling metadata and page bytes.', {
    ...selected, input: alias,
  }, ['workspace'], read],
  ['merchant_ckan_import', 'Import the selected host-declared retained CKAN edition through the original importer. The importer checks expectedSha256 before any edition is copied; the original complete manifest and all provider page hashes remain authoritative. On an uncertain reply inspect native.operation and retained editions before another action.', {
    ...changing, input: alias, expectedSha256: digest,
  }, [...changed, 'input', 'expectedSha256'], mutation],
  ['merchant_ckan_capture', 'Read and retain one selected package/resource through the original CKAN Action API capture engine. Choose actual provider filters, query and offset/keyset pagination; keyset with an _id filter requires offset instead. Returns the native operation ID immediately; follow status and resume that edition after interruption.', {
    ...changing, packageId: field, resourceId: field, filters: { type: 'object' },
    q: { type: 'string', maxLength: 2048 }, pagination: { type: 'string', enum: ['offset', 'keyset'] },
    pageSize: { type: 'integer', minimum: 1, maximum: 32000 }, maxRows: positive, maxBytes: positive,
    timeoutMs: { type: 'integer', minimum: 100, maximum: 300000 },
    maxResponseBytes: { type: 'integer', minimum: 1024, maximum: 67108864 },
  }, [...changed, 'packageId', 'resourceId'], { ...mutation, openWorld: true }],
  ['merchant_ckan_capture_resume', 'Resume this original unfinished retained edition and its saved provider selection/cursor. Reuses accepted pages through the native capture engine. It does not allocate another edition.', {
    ...changing, editionId: uuid, maxRows: positive, maxBytes: positive,
  }, [...changed, 'editionId'], { ...mutation, openWorld: true }],
  ['merchant_ckan_edition', 'Inspect one original edition, complete source fields, type/alias suggestions and first twenty source rows, or the retained progress of an unfinished edition. Exact number tokens are presented as strings without changing retained source bytes.', {
    ...selected, editionId: uuid,
  }, ['workspace', 'editionId'], read],
  ['merchant_ckan_compare', 'Compare two complete editions of the same original resource using the selected unique non-null source key. Returns original counts, metadata identities and the first hundred changes. Public column names remain data; exact numeric tokens are strings in this tool presentation.', {
    ...selected, beforeId: uuid, afterId: uuid, key: field,
  }, ['workspace', 'beforeId', 'afterId'], read],
  ['merchant_ckan_source_save', 'Save an explicit public field projection bound to the inspected original capture SHA256. Field names, aliases, nullability and native/text/json encoding are checked by the original typed source engine. Returns a native operation whose result is the saved source and preview.', {
    ...changing, editionId: uuid, title: shortText, query: columnName, projection, expectedCaptureSha256: digest,
  }, [...changed, 'editionId', 'title', 'query', 'projection', 'expectedCaptureSha256'], mutation],
  ['merchant_ckan_publication_create', 'Create a candidate through the original publisher using this saved source title/projection. Select the public filters, ranges, sorts and page limits plus extraction order and budgets. The retained native publication/run IDs own review and recovery.', {
    ...changing, sourceId: uuid, filters: fields, ranges: fields, sorts: fields, defaultLimit: positive, maxLimit: positive,
    order: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'object', additionalProperties: false,
      properties: { column: columnName, direction: { type: 'string', enum: ['asc', 'desc'] } }, required: ['column', 'direction'] } },
    maxRows: positive, maxBytes: positive, timeoutMs: positive,
  }, [...changed, 'sourceId'], mutation],
  ['merchant_ckan_publication', 'Read one original publication/run and inspect its exact candidate or published dataset, optionally using an original query string. Use native.run.data.candidate.candidateDigest and the original review ID for the next reviewed action.', {
    ...selected, publicationId: uuid, query: { type: 'string', maxLength: 8192 },
  }, ['workspace', 'publicationId'], read],
  ['merchant_ckan_publication_review', 'Record the review of this exact original candidate SHA256 through the original publisher. Read the resulting original run/review ID before publication; a stale candidate cannot be reviewed.', {
    ...changing, publicationId: uuid, expectedCandidateDigest: digest, reviewer: shortText,
    note: { type: 'string', minLength: 1, maxLength: 2000 },
  }, [...changed, 'publicationId', 'expectedCandidateDigest', 'reviewer', 'note'], mutation],
  ['merchant_ckan_publication_recover', 'Recover this original retained publication/run through the original publisher after interruption. Inspect the retained run; recovery does not allocate a replacement publication.', {
    ...changing, publicationId: uuid,
  }, [...changed, 'publicationId'], mutation],
  ['merchant_ckan_publish', 'Publish the exact original reviewed candidate with its original review ID. The original publisher governs recovery and already-published replay; inspect native.operation and the retained publication after an uncertain reply.', {
    ...changing, publicationId: uuid, reviewId: uuid,
  }, [...changed, 'publicationId', 'reviewId'], mutation],
  ['merchant_ckan_merchant_export', 'Create a complete portable original CKAN merchant package for the inspected candidate digest, using this host-declared origin/path/payment offer. The operation returns its original export ID and manifest SHA256. Receive its original files with merchant_ckan_files/file_read.', {
    ...changing, publicationId: uuid, expectedCandidateDigest: digest,
  }, [...changed, 'publicationId', 'expectedCandidateDigest'], mutation],
  ['merchant_ckan_merchant_stage', 'Stage the original complete package in this project seller-releases using the inspected manifest SHA256 and host-declared runtime. Requires releaseStoreMatches so the generic merchant release controls address that same original store. Select/start the resulting release through those original controls.', {
    ...changing, exportId: uuid, expectedManifestSha256: digest, releaseId: alias, label: shortText,
  }, [...changed, 'exportId', 'expectedManifestSha256', 'releaseId'], mutation],
  ['merchant_ckan_buyer_offer', 'Read the actual unpaid offer for one original exported dataset and query from the host-bound seller. Returns the original offer SHA256/options for preparing the same buyer request.', {
    ...selected, exportId: uuid, query: { type: 'string', maxLength: 8192 },
  }, ['workspace', 'exportId'], { readOnly: true, openWorld: true }],
  ['merchant_ckan_buyer_prepare', 'Prepare an original SF88 buyer configuration from the selected current actual seller offer, exact offer SHA256, accepted option index and original SF88 intent ID. The original buyer handoff retains its config; receive that file through merchant_ckan_files/file_read.', {
    ...changing, exportId: uuid, query: { type: 'string', maxLength: 8192 }, offerSha256: digest,
    acceptIndex: offset, intentId: { type: 'string', pattern: INTENT.source },
  }, [...changed, 'exportId', 'offerSha256', 'acceptIndex', 'intentId'], { ...mutation, openWorld: true }],
  ['merchant_ckan_files', 'List exact original source declaration, complete portable merchant package, or prepared buyer configuration files with their byte counts and SHA256. Choose the native source/export/buyer item ID from retained state. Source and buyer files are private handoff artifacts.', fileSelection, ['workspace', 'kind', 'itemId'], read],
  ['merchant_ckan_file_read', 'Read one listed original file in SHA256-pinned base64 chunks through the existing retained-file reader. Reuse readId, expectedSha256 and nextOffset. After expiry/restart omit readId and resume the same item/file/hash/offset; the final chunk releases its snapshot.', {
    ...fileSelection, file: { type: 'string', minLength: 1, maxLength: 512 }, readId: uuid, expectedSha256: digest, offset,
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
  }, ['workspace', 'kind', 'itemId', 'file'], read],
  ['merchant_ckan_file_release', 'Release this alias verified original-file snapshot. Retained source, merchant package and buyer configuration files remain available.', {
    ...selected, readId: uuid,
  }, ['workspace', 'readId'], read],
  ['merchant_ckan_cancel', 'Cancel only this exact currently active original operation. A stale operation ID cannot cancel a successor. Read the resulting native operation state and retained project items before continuing.', {
    ...selected, operationId: uuid,
  }, ['workspace', 'operationId'], { destructive: true, idempotent: false }],
];

function ckanWorkspaceTools(tool) { return definitions.map(definition => tool(...definition)); }

export { ckanWorkspaceTools, definitions, read, selected, uuid, offset, field, alias, changing, digest, changed, mutation, positive, shortText, columnName, projection, fields, INTENT, fileSelection, UUID, SHA256 };
