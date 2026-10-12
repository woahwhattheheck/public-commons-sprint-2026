// MIT. Static FRED tool metadata; imports no source, merchant or buyer runtime.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const operation = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision = { type: 'integer', minimum: 1 };
const offset = { type: 'integer', minimum: 0, maximum: 1000000 };
const limit = { type: 'integer', minimum: 1, maximum: 100 };
const object = { type: 'object' };
const workspace = { workspace: alias };
const recorded = { ...workspace, id: operation, expectedRevision: revision };
const publication = { ...workspace, publicationId: digest };
const purchase = { ...publication, intentId: operation };
const read = { readOnly: true, idempotent: true };
const change = { idempotent: true };
const records = ['captures', 'reviews', 'publications', 'operations'];
export const fredFileSelection = {
  kind: { type: 'string', enum: ['source', 'comparison', 'project', 'customer'] },
  captureId: digest, before: digest, after: digest, publicationId: digest, intentId: operation
};
export function fredWorkspaceTools(tool) {
  return [
    tool('merchant_fred_workspaces', 'List original configured economic workspace aliases and source/profile names.', {}, [], read),
    tool('merchant_fred_status', 'Inspect the original project, revision, source and publication counts, native merchant, buyer configuration and pending acquisition.', workspace, ['workspace'], read),
    tool('merchant_fred_inputs', 'List host-retained source aliases and the complete configured public merchant/payment profiles.', workspace, ['workspace'], read),
    tool('merchant_fred_input_inspect', 'Read the exact complete host input and return its original source metadata, byte count and SHA256 before import.', { ...workspace, input: alias }, ['workspace', 'input'], read),
    tool('merchant_fred_records', 'Page saved captures, reviews, publications or operations from one original project revision. Keep expectedRevision across pages.', {
      ...workspace, kind: { type: 'string', enum: records }, offset, limit, expectedRevision: revision
    }, ['workspace', 'kind'], read),
    tool('merchant_fred_record', 'Read one complete saved capture metadata, review, publication or original operation from the same project.', {
      ...workspace, kind: { type: 'string', enum: records }, id: { type: 'string', minLength: 1, maxLength: 96 }, expectedRevision: revision
    }, ['workspace', 'kind', 'id'], read),
    tool('merchant_fred_operation', 'Recover the durable original project operation and pending source-acquisition progress after an interrupted response.', {
      ...workspace, id: operation
    }, ['workspace', 'id'], read),
    tool('merchant_fred_observations', 'Read original observations in native 100-row pages. Preserve series frequency, units, seasonality, missing values and source time basis; follow nextOffset.', {
      ...workspace, captureId: digest, series: { type: 'string', minLength: 1, maxLength: 120 }, offset
    }, ['workspace', 'captureId'], read),
    tool('merchant_fred_compare', 'Page the original change report between two retained source editions, including revisions and missing values.', {
      ...workspace, before: digest, after: digest, offset
    }, ['workspace', 'before', 'after'], read),
    tool('merchant_fred_configure', 'Save the complete original FRED selection with its stable operation ID and reviewed project revision.', {
      ...recorded, selection: object
    }, ['workspace', 'id', 'expectedRevision', 'selection'], change),
    tool('merchant_fred_capture', 'Acquire official FRED API responses through the original workspace environment and retained acquisition. Reuse this same ID and revision for continuation.', recorded,
      ['workspace', 'id', 'expectedRevision'], { ...change, openWorld: true }),
    tool('merchant_fred_import', 'Import the complete declared public table or retained API capture. Exact source text, metadata and bytes pass to the original project importer.', {
      ...recorded, input: alias, expectedSha256: digest
    }, ['workspace', 'id', 'expectedRevision', 'input'], change),
    tool('merchant_fred_combine', 'Combine one to fifty distinct retained public-table captures into a complete economic edition. The native model preserves each publisher, frequency, unit and retrieval basis.', {
      ...recorded, captureIds: { type: 'array', items: digest, minItems: 1, maxItems: 50, uniqueItems: true }
    }, ['workspace', 'id', 'expectedRevision', 'captureIds'], change),
    tool('merchant_fred_select', 'Select the original retained capture in this same project.', {
      ...recorded, captureId: digest
    }, ['workspace', 'id', 'expectedRevision', 'captureId'], change),
    tool('merchant_fred_review', 'Save the exact source projection policy and review note against an original capture and project revision.', {
      ...recorded, captureId: digest, policy: object, note: { type: 'string', maxLength: 8000 }
    }, ['workspace', 'id', 'expectedRevision', 'captureId'], change),
    tool('merchant_fred_publish', 'Publish the saved review using one host-selected original merchant origin, route and complete payment profile.', {
      ...recorded, reviewId: digest, profile: alias
    }, ['workspace', 'id', 'expectedRevision', 'reviewId', 'profile'], change),
    tool('merchant_fred_abandon', 'Explicitly close the selected pending source operation while retaining its acquisition and immutable preparations.', {
      ...recorded, pendingId: operation
    }, ['workspace', 'id', 'expectedRevision', 'pendingId'], change),
    tool('merchant_fred_merchant_start', 'Start the reviewed original publication through this workspace’s configured facilitator and merchant port.', publication,
      ['workspace', 'publicationId'], { openWorld: true }),
    tool('merchant_fred_merchant_stop', 'Stop the selected original merchant listener owned by this workspace.', publication,
      ['workspace', 'publicationId'], change),
    tool('merchant_fred_publication', 'Inspect the exact economic edition, dataset schema, snapshot, advertised file hashes and original public payment offers.', publication,
      ['workspace', 'publicationId'], read),
    tool('merchant_fred_requests', 'Page the prepared original customer intents for a publication. Use recover on the same intent after dispatch uncertainty.', {
      ...publication, offset, limit, expectedViewSha256: digest
    }, ['workspace', 'publicationId'], read),
    tool('merchant_fred_preview', 'Run the original native dataset query as a local edition preview, preserving the selected snapshot.', {
      ...publication, query: { type: 'string', maxLength: 32768 }
    }, ['workspace', 'publicationId'], read),
    tool('merchant_fred_prepare', 'Retain one original customer request for the selected publication. For the next page pass the actual preceding page metadata and next cursor; for a full file choose its advertised path.', {
      ...purchase, query: { type: 'string', maxLength: 32768 }, file: { type: 'string', minLength: 1, maxLength: 2048 },
      previous: object, acceptIndex: { type: 'integer', minimum: 0, maximum: 1000 }
    }, ['workspace', 'publicationId', 'intentId'], change),
    tool('merchant_fred_buy', 'Execute the prepared original intent through the workspace’s maintained SF88 buyer and native approval/finality flow. Recover the same intent after any interrupted reply.', purchase,
      ['workspace', 'publicationId', 'intentId'], { openWorld: true }),
    tool('merchant_fred_recover', 'Recover the original intent, native receipt and retained response without preparing another payment. Use file_read for the complete delivered bytes.', purchase,
      ['workspace', 'publicationId', 'intentId'], { idempotent: true, openWorld: true }),
    tool('merchant_fred_file_read', 'Read complete original source, comparison, project export or saved customer-delivery bytes in retained chunks. Continue the returned readId/offset; verify the complete file SHA256.', {
      ...workspace, ...fredFileSelection, expectedSha256: digest,
      readId: { type: 'string', minLength: 1, maxLength: 96 }, offset: { type: 'integer', minimum: 0, maximum: 268435456 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES }
    }, ['workspace', 'kind'], read),
    tool('merchant_fred_file_release', 'Release this client’s retained download descriptor when the original file is no longer needed.', {
      ...workspace, readId: { type: 'string', minLength: 1, maxLength: 96 }
    }, ['workspace', 'readId'], change),
    tool('merchant_fred_disconnect', 'Close this borrowed client and its file reads. A later status attaches to the same project using its current original connection record.', workspace,
      ['workspace'], change)
  ];
}
