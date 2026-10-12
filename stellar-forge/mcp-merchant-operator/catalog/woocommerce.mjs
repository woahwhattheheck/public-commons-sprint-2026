// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const HASH = /^[0-9a-f]{64}$/;

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const reviewId = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' };

const orderId = { type: 'string', pattern: '^[1-9][0-9]{0,17}$' };

const uuid = { type: 'string', pattern: UUID.source };

const sha256 = { type: 'string', pattern: HASH.source };

const kind = { type: 'string', enum: ['review', 'refund'] };

const currency = { type: 'string', pattern: '^[A-Z0-9]{3,12}$' };

const amount = { type: 'string', pattern: '^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,6})?$' };

const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, expectedSnapshotSha256: sha256 };

const base = { store: alias };

const exported = { ...base, kind, id: reviewId, exportId: alias };

const read = { readOnly: true, idempotent: true };

const definitions = [
  ['merchant_woo_stores', 'List configured Woo stores, native receipt aliases, accounting export roots and this connection file-read state. Resolves no credential values and makes no network request.',
    base, [], read],
  ['merchant_woo_store_status', 'Inspect the original installed Woo console, current manager identity, native journal counts, currency, storage mode and merchant setup readiness through the same store client.',
    base, ['store'], { ...read, openWorld: true }],
  ['merchant_woo_queue', 'Read one page of the actual existing Woo checkout, bound-order, native-notice or attempt queue. Select an original order ID from its returned rows before native review. Native state filters, totals and page counts come from the installed console.',
    { ...base, scope: { type: 'string', enum: ['checkout', 'bound', 'notices', 'attempts'] },
      page: { type: 'integer', minimum: 1, maximum: 1000000 }, limit: page.limit,
      state: { type: 'string', pattern: '^[A-Za-z0-9_-]{0,64}$' },
      sort: { type: 'string', enum: ['oldest', 'newest'] }, orderId },
    ['store'], { ...read, openWorld: true }],
  ['merchant_woo_order', 'Read the selected original Woo order through its configured manager Application Password. Returns its current identity, revision, native notice, release and order state.',
    { ...base, order: orderId }, ['store', 'order'], { ...read, openWorld: true }],
  ['merchant_woo_review_source', 'Inspect a host-declared original native receipt and trusted payer. Retain recordSha256 before reviewing a selected Woo order.',
    { ...base, source: alias }, ['store', 'source'], read],
  ['merchant_woo_review', 'Retain and reconcile the original SF98 notice and native receipt for one Woo order through the original SF86 verifier. Supply the inspected receipt hash and stable review ID. Reopening an ID preserves its first source and exact native terms.',
    { ...base, source: alias, reviewId, order: orderId, expectedRecordSha256: sha256 },
    ['store', 'source', 'reviewId', 'order', 'expectedRecordSha256'], { idempotent: true, openWorld: true }],
  ['merchant_woo_review_resume', 'Resume the same retained native review with its original payer, receipt, RPC profile and page limit. Existing completed reviews reopen without another chain review.',
    { ...base, reviewId }, ['store', 'reviewId'], { idempotent: true, openWorld: true }],
  ['merchant_woo_review_status', 'Reopen the original review, source identities and paged release attempts. live:true independently reads the same Woo order after an interrupted release; it sends no release request.',
    { ...base, reviewId, live: { type: 'boolean' }, ...page }, ['store', 'reviewId'], { ...read, openWorld: true }],
  ['merchant_woo_release', 'Explicitly complete or recover the same reviewed Woo order. Supply its exact review SHA256 and repeat the selected decimal order ID in confirmOrder. The original operator journals one dispatch and independently reads the result.',
    { ...base, reviewId, expectedReviewSha256: sha256, confirmOrder: orderId },
    ['store', 'reviewId', 'expectedReviewSha256', 'confirmOrder'], { openWorld: true }],
  ['merchant_woo_refunds', 'Inspect original payment identity, explicit Woo currency totals and actual native refund children or saved adjustment mappings. Page the selected rows from the same returned revision.',
    { ...base, order: orderId, view: { type: 'string', enum: ['refunds', 'adjustments'] }, ...page },
    ['store', 'order'], { ...read, openWorld: true }],
  ['merchant_woo_refund_source', 'Read an original accounting export from its host-declared export root and existing export UUID. Page adjustment identities or inspect one verified refund; retain sourceSha256 for preparation. Canonical verification stays in the accounting engine.',
    { ...base, source: alias, exportId: uuid, adjustmentId: uuid, ...page }, ['store', 'source', 'exportId'], read],
  ['merchant_woo_refund_prepare', 'Prepare the selected canonical verified refund on its exact original Woo order. Supply the inspected source hash, currency and explicit Woo amount separately from the native atomic amount. Retains original source, request and prepared review; it does not create a Woo refund child.',
    { ...base, source: alias, exportId: uuid, adjustmentId: uuid, order: orderId, expectedSourceSha256: sha256, wooAmount: amount, currency },
    ['store', 'source', 'exportId', 'adjustmentId', 'order', 'expectedSourceSha256', 'wooAmount', 'currency'], { openWorld: true }],
  ['merchant_woo_refund_apply', 'Explicitly record or recover the same prepared Woo order credit. Supply its exact prepared review SHA256 and selected order ID. Native bookkeeping uses the original saved reverse transfer and stable child metadata; partial refunds retain independent adjustment UUIDs.',
    { ...base, adjustmentId: uuid, expectedReviewSha256: sha256, confirmOrder: orderId },
    ['store', 'adjustmentId', 'expectedReviewSha256', 'confirmOrder'], { openWorld: true }],
  ['merchant_woo_refund_recover', 'Independently read the same order and retain the observed refund outcome after an interrupted prepare/apply. Sends no POST. REFUND_SAVED_JOURNAL_PENDING requires explicit same-ID apply to reconcile the original native child.',
    { ...base, adjustmentId: uuid }, ['store', 'adjustmentId'], { openWorld: true }],
  ['merchant_woo_refund_status', 'Read the original retained refund input, prepared review identities and paged outcomes. This offline read resolves no store credentials. Use refund_recover for a current native observation.',
    { ...base, adjustmentId: uuid, ...page }, ['store', 'adjustmentId'], read],
  ['merchant_woo_history', 'Page the original store workspace review or refund history, preserving its original operation IDs and unavailable-record outcomes.',
    { ...base, kind, ...page }, ['store', 'kind'], read],
  ['merchant_woo_export', 'Retain a complete original review/refund export under a host-selected customer root. Choose a stable new export ID for this saved operation state. Reusing identical export inputs reopens its exact original manifest; later outcomes use another export ID.',
    exported, ['store', 'kind', 'id', 'exportId'], { idempotent: true }],
  ['merchant_woo_export_status', 'Reopen the original completed export manifest and its file identities after an interrupted response or MCP restart.',
    exported, ['store', 'kind', 'id', 'exportId'], read],
  ['merchant_woo_file', 'Read a manifest-selected original export file in SHA-pinned chunks. Repeat store, kind, operation ID, export ID, manifest SHA, file SHA and readId when continuing. Completed or expired reads reopen the same original bytes by digest.',
    { ...exported, file: { type: 'string', pattern: FILE.source }, expectedManifestSha256: sha256,
      expectedSha256: sha256, readId: uuid, offset: page.offset, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
    ['store', 'kind', 'id', 'exportId', 'file', 'expectedManifestSha256'], read],
  ['merchant_woo_file_release', 'Release a temporary original-file snapshot owned by this store connection. Source exports and saved Woo operations remain in their original directories.',
    { ...base, readId: uuid }, ['store', 'readId'], read],
];

const woocommerceTools = tool => definitions.map(parts => tool(...parts));

export { woocommerceTools, definitions, base, read, page, orderId, alias, reviewId, sha256, uuid, amount, currency, kind, exported, FILE, HASH, UUID };
