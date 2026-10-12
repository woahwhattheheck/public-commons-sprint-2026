// MIT. Source-only tool definitions for the maintained Huwise / Opendatasoft application.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
export const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
export const uuid = { type: 'string', pattern: '^[a-f0-9-]{36}$' };
export const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const object = { type: 'object' }, text = { type: 'string' }, read = { readOnly: true, idempotent: true };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const query = { type: 'object', properties: {
  where: text, order_by: text, refine: { type: 'array', items: text }, exclude: { type: 'array', items: text },
  lang: text, timezone: text, limit: { type: 'integer', minimum: 1, maximum: 100 },
  offset: { type: 'integer', minimum: 0 }, select: text, group_by: text
}, additionalProperties: false };
export function opendatasoftWorkspaceTools(tool) {
  const scope = { workspace: alias };
  const make = (name, description, properties = {}, required = [], hints = {}) =>
    tool('merchant_opendatasoft_' + name, description, { ...scope, ...properties }, ['workspace', ...required], hints);
  return [
    tool('merchant_opendatasoft_status', 'List host-declared Huwise / Opendatasoft projects or inspect one original workspace, its current native operation and complete paged histories.', { workspace: alias, ...page }, [], read),
    make('open', 'Open the original retained Huwise workbench with its native exclusive workspace lease. Optional browser uses this same workbench. Creation is available only when the host connection explicitly enables it.', { browser: { type: 'boolean' } }, [], { idempotent: true }),
    make('close', 'Drain and close this process-owned original workbench and its borrowed browser; retain every saved edition, publication, buyer request and completed file export.', { instanceId: uuid }, ['instanceId'], { destructive: true }),
    make('search', 'Search the configured portal through its original Explore API catalog query and return its actual provider page.', { query }, [], { ...read, openWorld: true }),
    make('dataset', 'Read original dataset metadata, fields, rights and provider receipt from the configured portal.', { datasetId: text }, ['datasetId'], { ...read, openWorld: true }),
    make('preview', 'Run the original Explore records query. Follow its provider page; use capture for complete retained source data.', { datasetId: text, query }, ['datasetId'], { ...read, openWorld: true }),
    make('capture', 'Start a complete source-native capture with unchanged ODSQL clauses and the host-selected portal. Returns the original operation and edition IDs; inspect operation before any retry.', { selection: object }, ['selection'], { openWorld: true }),
    make('resume', 'Resume the same unfinished original capture and its retained provider files.', { editionId: uuid, limits: object }, ['editionId'], { openWorld: true }),
    make('import', 'Import a host-declared complete original capture into this workbench. The native importer verifies its source identity and reuses an already retained capture.', { sourceImport: alias }, ['sourceImport'], { idempotent: true }),
    make('operation', 'Inspect the current original operation by its returned ID, including native progress, completion or error. A different current operation is reported as a conflict.', { operationId: uuid }, ['operationId'], read),
    make('cancel', 'Cancel the exact currently running native capture or publication operation. Keep its original ID and inspect completion before resuming.', { operationId: uuid }, ['operationId'], { destructive: true }),
    make('edition', 'Read original retained edition metadata, field suggestions, source identities, sample records and notes at their current revision.', { editionId: uuid }, ['editionId'], read),
    make('rows', 'Read a complete page of original retained source rows, preserving exact number tokens and structured values.', { editionId: uuid, offset: page.offset, limit: { type: 'integer', minimum: 1, maximum: 1000 } }, ['editionId'], read),
    make('facets', 'Count original retained values or array members for the exact selected field, including missing and null values.', { editionId: uuid, field: text, limit: { type: 'integer', minimum: 1, maximum: 1000 }, mode: { type: 'string', enum: ['value', 'members'] } }, ['editionId', 'field'], read),
    make('notes', 'Save complete edition and row notes through the original capture digest and notes revision guard. Inspect the returned operation; an exact repeated edit uses native recovery.', { editionId: uuid, expectedCaptureSha256: hash, expectedRevision: { type: 'integer', minimum: 0 }, text, rowNotes: { type: 'array', maxItems: 10000, items: { type: 'object', properties: { rowIndex: { type: 'integer', minimum: 0 }, text }, required: ['rowIndex', 'text'], additionalProperties: false } } }, ['editionId', 'expectedCaptureSha256', 'expectedRevision', 'text', 'rowNotes']),
    make('compare', 'Compare two original complete editions of the same dataset by one actual unique field. Page every source change with offsets.', { before: uuid, after: uuid, key: text, ...page }, ['before', 'after', 'key'], read),
    make('source_save', 'Save a typed original field projection against the inspected capture SHA256. Reuses the native compiler, exact-value conversions and source declaration writer.', { editionId: uuid, expectedCaptureSha256: hash, projection: object, query: text, title: text }, ['editionId', 'expectedCaptureSha256', 'projection']),
    make('publication_create', 'Create an original dataset publication candidate from a retained typed source. The native publisher owns extraction, ordering, limits and cancellation.', { sourceId: uuid, plan: object }, ['sourceId']),
    make('publication', 'Inspect the exact original publication candidate, review and dataset query.', { publicationId: uuid, query: text }, ['publicationId'], read),
    make('publication_review', 'Review the exact native candidate digest with the named reviewer and review note.', { publicationId: uuid, expectedCandidateDigest: hash, reviewer: text, note: text }, ['publicationId', 'expectedCandidateDigest', 'reviewer', 'note']),
    make('publication_recover', 'Recover this same retained original publication run from its current native state.', { publicationId: uuid }, ['publicationId']),
    make('publication_publish', 'Publish the original reviewed dataset version using its actual review ID. Completed native publication remains idempotent.', { publicationId: uuid, reviewId: text }, ['publicationId', 'reviewId'], { idempotent: true }),
    make('merchant_export', 'Export the complete original reviewed merchant package with a host-declared payment, origin and route profile.', { publicationId: uuid, expectedCandidateDigest: hash, merchant: alias }, ['publicationId', 'expectedCandidateDigest', 'merchant']),
    make('merchant_stage', 'Stage the original immutable merchant package into its existing seller release store with the host-configured runtime.', { merchantExportId: uuid, expectedManifestSha256: hash, releaseId: alias, label: text }, ['merchantExportId', 'expectedManifestSha256', 'releaseId']),
    make('buyer_offer', 'Read the original seller offer for this retained package through a host-declared seller endpoint and the exact dataset query.', { merchantExportId: uuid, seller: alias, query: text }, ['merchantExportId', 'seller'], { ...read, openWorld: true }),
    make('buyer_prepare', 'Prepare the original buyer request from the actual offer SHA256, accept index and unchanged intent ID. The native buyer request remains in the original workbench.', { merchantExportId: uuid, seller: alias, query: text, intentId: text, acceptIndex: { type: 'integer', minimum: 0 }, offerSha256: hash }, ['merchantExportId', 'seller', 'intentId', 'acceptIndex', 'offerSha256'], { openWorld: true }),
    make('tenant_targets','List named tenant connections available to this original workbench without exposing token values.',{},[],read),
    make('tenant_datasets','Look up the actual dataset UID on a selected named tenant using native dataset_id, limit and offset.',{ target:alias,query:object },['target'],{ ...read,openWorld:true }),
    make('tenant_prepare','Save a complete tenant ingestion plan from the exact source edition/capture and notes revision, explicit target/access, native configuration and published receiving criteria. Supply exactly one of plan or planJson; planJson preserves complete native numeric literals.',{ plan:object,planJson:{ type:'string',minLength:2,maxLength:8388608 } }),
    make('tenant_plan','Inspect the complete saved tenant plan, native workflow, preimage, review, processing and receiving result.',{ planId:uuid },['planId'],read),
    make('tenant_inspect','Retain the actual complete native tenant configuration and prepare the exact source upload and configuration workflow for review.',{ planId:uuid },['planId'],{ openWorld:true }),
    make('tenant_review','Review the exact saved plan and current native configuration SHA256.',{ planId:uuid,planSha256:hash,configurationSha256:hash,note:text },['planId','planSha256','configurationSha256']),
    make('tenant_apply','Apply the saved review through original dataset/resource/field/processor/security/schedule APIs and the selected native publish action. Inspect the returned original operation before continuing.',{ planId:uuid,reviewId:uuid },['planId','reviewId'],{ openWorld:true }),
    make('tenant_recover','Recover interrupted native tenant steps from original response bytes and actual provider configuration. An actual uploaded file UID is downloaded and compared to the full source before adoption.',{ planId:uuid,recovery:object },['planId'],{ openWorld:true }),
    make('tenant_status','Read and retain the original native dataset processing status, including publication state and record errors.',{ planId:uuid },['planId'],{ openWorld:true }),
    make('tenant_receive','Capture the complete published dataset through its actual Explore export and evaluate every reviewed receiving criterion.',{ planId:uuid,limits:object },['planId'],{ openWorld:true }),
    make('tenant_export','Create an immutable complete tenant delivery with the original full source, configuration, native journal, receiving export and operating guide.',{ planId:uuid },['planId']),
    make('tenant_delivery','Read and verify an existing complete native tenant delivery and its exact manifest.',{ tenantExportId:uuid },['tenantExportId'],read),
    make('export', 'Retain all four full analyst formats and their original source identities at the exact capture and notes revision. Optional selected merchant package, tenant ingestion delivery, operating guides, source declaration and buyer request are complete original native downloads. Keep exportId for retry and delivery.', { exportId: alias, editionId: uuid, expectedCaptureSha256: hash, expectedNotesRevision: { type: 'integer', minimum: 0 }, geometryField: text, sourceId: uuid, merchantExportId: uuid, buyerRequestId: uuid, tenantExportId: uuid }, ['exportId', 'editionId', 'expectedCaptureSha256', 'expectedNotesRevision'], { idempotent: true }),
    tool('merchant_opendatasoft_exports', 'List complete retained Huwise delivery exports across original workspace or merchant process restarts. Follow offsets for all exports.', { workspace: alias, ...page }, [], read),
    tool('merchant_opendatasoft_manifest', 'Read the original completed export manifest and its SHA256. The workbench can remain closed.', { exportId: alias }, ['exportId'], read),
    tool('merchant_opendatasoft_file', 'Read exact SHA-pinned bytes from a complete retained export. Continue with readId and offset; reopen an expired read with the same file SHA. The native descriptor reader avoids duplicating large files.', {
      exportId: alias, file: text, expectedManifestSha256: hash, expectedSha256: hash, readId: uuid,
      offset: page.offset, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES }
    }, ['exportId', 'file', 'expectedManifestSha256'], read),
    tool('merchant_opendatasoft_file_release', 'Release this export’s temporary native file descriptor while retaining the original complete files.', { exportId: alias, readId: uuid }, ['exportId', 'readId'], read),
  ];
}
