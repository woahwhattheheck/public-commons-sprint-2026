// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const SHA = /^[a-f0-9]{64}$/;

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const id = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' };

const sha = { type: 'string', pattern: SHA.source };

const uuid = { type: 'string', pattern: UUID.source };

const selected = { workspace: alias };

const read = { readOnly: true, idempotent: true };

const paging = { offset: { type: 'integer', minimum: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 100 }, expectedIndexSha256: sha };

const query = { ...selected, productId: id, input: { type: 'object',
  additionalProperties: { type: ['string', 'number'] }, required: ['q'] } };

const views = ['status', 'requests', 'request', 'candidates', 'decisions', 'packages', 'package',
  'deliveries', 'delivery', 'release-diff'];

const fileSelection = { ...selected, kind: { type: 'string', enum: ['capture', 'delivery', 'package', 'batch-delivery'] },
  id, file: { type: 'string', minLength: 1, maxLength: 240 } };

const batchId={type:'string',pattern:'^csv-[a-f0-9]{20}$'};
const batchSelection={...selected,batchId};
const batchPage={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const ordinal={type:'integer',minimum:1,maximum:10000};
const batchQuery={...selected,source:alias,productId:id,mapping:{type:'object'},
  label:{type:'string',minLength:1,maxLength:120},reuseRequestIds:{type:'array',maxItems:100,uniqueItems:true,items:id},
  supersedesBatchId:{...batchId,type:['string','null']}};
const batchRow={...batchSelection,ordinal,expectedRequestId:id};
const batchViews=['batches','rows','row','deliveries','delivery','delivery-row'];

function opencageWorkspaceTools(tool) {
  return [
    tool('merchant_opencage_batch_source','Inspect the exact bytes of a host-declared CSV source alias before choosing its original columns. Returns header names, row count, first 20 source rows and source SHA256; sends no provider request.',{
      ...selected,source:alias,
    },['workspace','source'],read),
    tool('merchant_opencage_batch_review','Review a complete CSV column mapping against the original geocoding product and current source/terms. Retains every input row, reports invalid input and unique query count, and binds explicitly selected original successful captures for reuse. Source aliases pin complete CSV bytes at host configuration load.',batchQuery,['workspace','source','productId','mapping'],read),
    tool('merchant_opencage_batch_prepare','Save the same reviewed CSV bytes, mapping, normalized per-row queries and source/terms binding into the original workspace. Each row gets its own stable capture and candidate decision. Reuse the same source and expectedReviewSha256 after an interrupted reply.',{
      ...batchQuery,expectedReviewSha256:sha,
    },['workspace','source','productId','mapping','expectedReviewSha256'],{idempotent:true}),
    tool('merchant_opencage_batch_inspect','Inspect original retained batches, paged progress rows, one row with original candidates, joined deliveries or a retained customer row. rows/row select batchId; row/delivery-row select ordinal; delivery/delivery-row select exportId. Collections use offset/limit; a rows page carries the current progress revision. Each source row keeps its one-based ordinal.',{
      ...selected,view:{type:'string',enum:batchViews},batchId,exportId:id,ordinal,...batchPage,
      status:{type:'string',enum:['READY','INVALID','CANDIDATES','NO_RESULTS','EXCEPTION','NEEDS_RECONCILIATION','SELECTED']},
    },['workspace','view'],read),
    tool('merchant_opencage_batch_run','Start or stop the original paced CSV loop, or reconcile its derived index from the original immutable intake, actual request/capture bundles and reviewed retry receipts. start/stop require the original runId; reconcile takes batchId only. Completed same-ID captures are reused. Quota, rate, credentials and uncertain dispatch remain distinct outcomes.',{
      ...batchSelection,action:{type:'string',enum:['start','stop','reconcile']},runId:id,
    },['workspace','batchId','action'],{openWorld:true}),
    tool('merchant_opencage_batch_select','Save one source row’s independent original candidate decision against its current request ID, native response hash and decision revision. null clears a choice. A repeated query in another row retains a separate decision.',{
      ...batchRow,responseSha256:sha,expectedRevision:{type:'integer',minimum:0,maximum:999},
      index:{type:['integer','null'],minimum:0,maximum:99},note:{type:'string',maxLength:2000},
    },['workspace','batchId','ordinal','expectedRequestId','responseSha256','expectedRevision','index'],{destructive:true}),
    tool('merchant_opencage_batch_retry','Prepare a separately reviewed new attempt for an exception row while retaining the original request/result. Require its current request ID, response hash or null, and a reason. An uncertain dispatch additionally requires acknowledgeUncertain:true; inspect/import its actual result whenever available. This operation does not dispatch the retry.',{
      ...batchRow,expectedResponseSha256:{...sha,type:['string','null']},reason:{type:'string',minLength:1,maxLength:500},
      acknowledgeUncertain:{type:'boolean'},
    },['workspace','batchId','ordinal','expectedRequestId','expectedResponseSha256','reason'],{destructive:true}),
    tool('merchant_opencage_batch_export','Freeze all current row capture/decision identities under the original workspace owner and publish a complete joined customer delivery. Requires the reviewed batch progress revision and a stopped batch. results.csv preserves every source row; exceptions.csv keeps invalid/unrun/empty/error/unselected rows; GeoJSON contains explicit selections. Original capture objects and licenses remain exact and deduplicated.',{
      ...batchSelection,expectedRevision:{type:'integer',minimum:0},
      maxBytes:{type:'integer',minimum:1048576,maximum:536870912},
    },['workspace','batchId','expectedRevision'],{idempotent:true}),
    tool('merchant_opencage_workspaces', 'List host-declared OpenCage workspaces and source aliases, process-owned operator/customer browsers and retained file reads. Opens no provider connection.', {}, [], read),
    tool('merchant_opencage_open', 'Open the original saved GeocodeWorkspace and its industrial browser on one process-owned instance. A new workspace uses the host-selected plan and terms. Saved captures, candidate decisions and merchant generations remain original.', selected, ['workspace'], { idempotent: true }),
    tool('merchant_opencage_close', 'Drain the exact owned operator, customer browsers, active original requests and file reads. Retain the workspace identity and reopen the same host alias after close.', {
      ...selected, instanceId: uuid,
    }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_opencage_inspect', 'Inspect original state, requests, ordered candidates, decision history, packages, deliveries or a release diff. id selects request/candidates/decisions/package/delivery. before and after select release-diff. Collections return nextOffset and indexSha256; continue with the same expectedIndexSha256. Complete native files use file_read.', {
      ...selected, view: { type: 'string', enum: views }, id, before: id, after: id, ...paging,
    }, ['workspace', 'view'], read),
    tool('merchant_opencage_query_review', 'Compile a query with the original selected product contract. Returns normalized query, source/terms identity, provider and merchant URLs, parameter descriptions and deterministic reviewSha256. This performs no provider request.', query, ['workspace', 'productId', 'input'], read),
    tool('merchant_opencage_capture', 'Dispatch one explicitly reviewed query through the original OpenCage source, deadline, configured host connection and workspace queue. Keep id/input/reviewSha256 unchanged after a lost reply; inspect that original id before continuing. A completed same-id result reopens without another request.', {
      ...query, id, reviewSha256: sha,
    }, ['workspace', 'productId', 'input', 'id', 'reviewSha256'], { openWorld: true }),
    tool('merchant_opencage_import_response', 'Import the complete response and HTTP observation from one host-declared original source alias. The original importer checks endpoint, normalized query, HTTP status, exact bytes/hash and retained dispatch identity. The alias pins both source files at MCP configuration load.', {
      ...query, id, source: alias,
    }, ['workspace', 'productId', 'input', 'id', 'source'], { idempotent: true }),
    tool('merchant_opencage_adopt_buyer', 'Recover one original retained SF88 Buyer operation from a host-declared client configuration and adopt its exact response. The original delivery verifies purchase configuration, intent, response bytes and selected merchant package/origin. This recovery does not execute a new purchase.', {
      ...selected, id, productId: id, buyer: alias,
      intentId: { type: 'string', minLength: 1, maxLength: 240 }, packageId: id,
    }, ['workspace', 'id', 'productId', 'buyer', 'intentId'], { idempotent: true }),
    tool('merchant_opencage_select', 'Save an explicit candidate index, or null to clear selection, against the original response SHA256 and current decision revision. Confidence describes spatial precision. After a lost reply inspect the same request and current decision before changing it.', {
      ...selected, id, responseSha256: sha, expectedRevision: { type: 'integer', minimum: 0, maximum: 999 },
      index: { type: ['integer', 'null'], minimum: 0, maximum: 99 }, note: { type: 'string', maxLength: 2000 },
    }, ['workspace', 'id', 'responseSha256', 'expectedRevision', 'index'], { destructive: true }),
    tool('merchant_opencage_export', 'Publish or reopen the complete original customer delivery for the reviewed response and decision revision: native response, CSV, GeoJSON, licensing, decision and provenance files. Returns the original export ID and manifest for receiving.', {
      ...selected, id, responseSha256: sha, expectedRevision: { type: 'integer', minimum: 0, maximum: 1000 },
    }, ['workspace', 'id', 'responseSha256', 'expectedRevision'], { idempotent: true }),
    tool('merchant_opencage_package', 'Prepare the original merchant package using current or explicitly supplied payment terms; alternatively import one host-declared existing package alias. Terms and source are mutually exclusive. The package retains original source, offers, SDK entries and release inputs.', {
      ...selected, terms: { type: 'object' }, source: alias,
    }, ['workspace'], { idempotent: true }),
    tool('merchant_opencage_release', 'Operate the SAME SF82 release store. stage selects packageId/id/optional label and the host facilitator. activate selects id/expectedGeneration; rollback selects expectedGeneration; start selects expectedGeneration; stop takes no further fields. Inspect current native state or release-diff before changing a generation and after an interrupted reply.', {
      ...selected, action: { type: 'string', enum: ['stage', 'activate', 'rollback', 'start', 'stop'] },
      id, packageId: id, label: { type: 'string', minLength: 1, maxLength: 120 },
      expectedGeneration: { type: 'integer', minimum: 0 },
      reason: { type: 'string', minLength: 1, maxLength: 240 },
    }, ['workspace', 'action'], { destructive: true, openWorld: true }),
    tool('merchant_opencage_customer', 'Open the original read-only customer browser for a retained export (kind delivery by default, or batch-delivery), or close that exact process-owned customer instance. open needs exportId; close also needs its instanceId. The customer browser and complete file reads use the original exported bytes.', {
      ...selected, action: { type: 'string', enum: ['open', 'close'] }, exportId: id, instanceId: uuid,
      kind:{type:'string',enum:['delivery','batch-delivery']},
    }, ['workspace', 'action', 'exportId'], { idempotent: true }),
    tool('merchant_opencage_file_read', 'Receive an exact original capture, merchant-package, delivery or batch-delivery file, including manifest.json, in resumable SHA256-pinned base64 chunks. Continue with the same selection/readId/expectedSha256 and nextOffset; after expiry or restart omit readId and resume the original selection/hash/offset.', {
      ...fileSelection, readId: uuid, expectedSha256: sha, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind', 'id', 'file'], read),
    tool('merchant_opencage_file_release', 'Release this workspace-owned temporary verified read. The original capture, customer delivery and merchant package remain available.', {
      ...selected, readId: uuid,
    }, ['workspace', 'readId'], read),
  ];
}

export { opencageWorkspaceTools, read, selected, uuid, views, id, paging, query, sha, alias, fileSelection, UUID, SHA };
