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

const fileSelection = { ...selected, kind: { type: 'string', enum: ['capture', 'delivery', 'package'] },
  id, file: { type: 'string', minLength: 1, maxLength: 240 } };

function opencageWorkspaceTools(tool) {
  return [
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
    tool('merchant_opencage_customer', 'Open the original read-only customer browser for a retained export, or close that exact process-owned customer instance. open needs exportId; close also needs its instanceId. The customer browser and complete file reads use the original exported bytes.', {
      ...selected, action: { type: 'string', enum: ['open', 'close'] }, exportId: id, instanceId: uuid,
    }, ['workspace', 'action', 'exportId'], { idempotent: true }),
    tool('merchant_opencage_file_read', 'Receive an exact original capture, merchant-package or delivery file, including manifest.json, in resumable SHA256-pinned base64 chunks. Continue with the same selection/readId/expectedSha256 and nextOffset; after expiry or restart omit readId and resume the original selection/hash/offset.', {
      ...fileSelection, readId: uuid, expectedSha256: sha, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind', 'id', 'file'], read),
    tool('merchant_opencage_file_release', 'Release this workspace-owned temporary verified read. The original capture, customer delivery and merchant package remain available.', {
      ...selected, readId: uuid,
    }, ['workspace', 'readId'], read),
  ];
}

export { opencageWorkspaceTools, read, selected, uuid, views, id, paging, query, sha, alias, fileSelection, UUID, SHA };
