// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

const SHA = /^[0-9a-f]{64}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const DSS_KINDS = ['dss','report','mapping','rows','native','comparison','plan','handover'];

const ANALYSIS_VIEWS = ['series','source-pages','observations','baseline-observations','conflicts','conflict-records','added','removed','changed','unresolved','unresolved-previous','unresolved-current'];

const alias = { type: 'string', pattern: ALIAS.source };

const id = { type: 'string', pattern: ID.source };

const digest = { type: 'string', pattern: SHA.source };

const selection = { workspace: alias };

const edition = { ...selection, editionId: id };

const dss = { ...selection, dssId: id };

const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: digest };

const chunk = { readId: { type: 'string', pattern: UUID.source }, expectedSha256: digest,
  offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };

const mapping = { mapping: { type: 'object' }, mappingFile: alias, expectedMappingFileSha256: digest, previousDssId: id };

const analysis = { captureId: id, options: { type: 'object' }, comparisonCaptureId: id };

const analysisDetail = { view: { type: 'string', enum: ANALYSIS_VIEWS }, seriesKey: { type: 'string', minLength: 1, maxLength: 4096 }, featureKey: { type: 'string', minLength: 1, maxLength: 4096 } };

const read = { readOnly: true, idempotent: true };

function usgsWorkspaceTools(tool) {
  return [
    tool('merchant_usgs_workspaces', 'List declared original Water projects, source handles, owned consoles and file reads.', {}, [], read),
    tool('merchant_usgs_open', 'Open the original Water operator console on a declared private project. Reuses this host’s existing session.', selection, ['workspace'], { idempotent: true }),
    tool('merchant_usgs_close', 'Cancel and drain this host’s original Water jobs, close its console and release its file reads. Saved source, editions and DSS operations remain available for reopening.', selection, ['workspace'], { idempotent: true }),
    tool('merchant_usgs_status', 'Read the original project revision, job progress, capture/review/edition/export counts and merchant state.', selection, ['workspace'], read),
    tool('merchant_usgs_inventory', 'Page original captures, reviews, editions, DSS exports, active-session jobs or project history using a stable inventory hash.', { ...selection, kind: { type: 'string', enum: ['captures','reviews','editions','dssExports','jobs','history'] }, ...page }, ['workspace','kind'], read),
    tool('merchant_usgs_project_save', 'Save a complete original USGS selection with the project’s current revision.', { ...selection, title: { type: 'string', minLength: 1, maxLength: 200 }, selection: { type: 'object' }, expectedRevision: { type: 'integer', minimum: 0 } }, ['workspace','title','selection','expectedRevision'], { idempotent: true }),
    tool('merchant_usgs_capture_start', 'Start or resume the original capture ID at its retained project revision. The original console tracks progress, pages and provider retry state.', { ...selection, captureId: id, expectedRevision: { type: 'integer', minimum: 1 } }, ['workspace','captureId','expectedRevision'], { openWorld: true }),
    tool('merchant_usgs_capture_cancel', 'Cancel this console’s named original capture while retaining its saved request and completed pages.', { ...selection, captureId: id }, ['workspace','captureId'], { idempotent: true }),
    tool('merchant_usgs_capture', 'Inspect original capture metadata and counts. Use capture_pages for exact retained response-page identities.', { ...selection, captureId: id }, ['workspace','captureId'], read),
    tool('merchant_usgs_capture_pages', 'Page original provider response URLs, hashes and retrieval metadata.', { ...selection, captureId: id, ...page }, ['workspace','captureId'], read),
    tool('merchant_usgs_capture_file_read', 'Read an original retained provider response page by its native capture and page index, with stable byte-offset continuation.', { ...selection, captureId: id, pageIndex: { type: 'integer', minimum: 0 }, ...chunk }, ['workspace','captureId','pageIndex'], read),
    tool('merchant_usgs_analysis', 'Analyze the retained original capture and optional original comparison. Original values, clocks, units and qualifiers stay attached; series are paged.', { ...selection, ...analysis, ...analysisDetail, ...page }, ['workspace','captureId'], read),
    tool('merchant_usgs_review_save', 'Retain the exact native analysis decision and note under a stable review ID and original capture hash.', { ...selection, ...analysis, reviewId: id, expectedCaptureSha256: digest, note: { type: 'string', maxLength: 24000 } }, ['workspace','captureId','reviewId','expectedCaptureSha256'], { idempotent: true }),
    tool('merchant_usgs_review', 'Read a saved review identity, decision and paged original series. Download the complete review through review_file_read.', { ...selection, reviewId: id, ...analysisDetail, ...page }, ['workspace','reviewId'], read),
    tool('merchant_usgs_review_file_read', 'Read the original complete HTML, JSON, CSV or GeoJSON review export in verified chunks.', { ...selection, reviewId: id, format: { type: 'string', enum: ['html','json','csv','geojson'] }, ...chunk }, ['workspace','reviewId','format'], read),
    tool('merchant_usgs_edition_prepare', 'Build or reopen the original immutable merchant/source edition from a saved review.', { ...edition, reviewId: id }, ['workspace','editionId','reviewId'], { idempotent: true }),
    tool('merchant_usgs_edition', 'Read the selected native edition and page its complete original member manifest.', { ...edition, ...page }, ['workspace','editionId'], read),
    tool('merchant_usgs_edition_file_read', 'Read one exact manifest member of a retained original USGS edition. The member must occur in its verified native manifest.', { ...edition, member: { type: 'string', minLength: 1, maxLength: 1024 }, ...chunk }, ['workspace','editionId','member'], read),
    tool('merchant_usgs_configured_file', 'Inspect one declared original mapping or complete handover file and its current exact byte hash.', { ...selection, file: alias }, ['workspace','file'], read),
    tool('merchant_usgs_dss_source', 'Inspect native source identity and page every original series, including units, clocks, value states and approval counts.', { ...edition, ...page }, ['workspace','editionId'], read),
    tool('merchant_usgs_dss_preview', 'Review the original HEC-DSS plan using a complete mapping or declared mapping-file handle. Returns exact plan/mapping/source hashes and paged series with their selected native settings.', { ...edition, ...mapping, ...page }, ['workspace','editionId'], read),
    tool('merchant_usgs_dss_start', 'Start or reopen the original native DSS export with the exact reviewed plan hash. An unchanged completed ID reopens without another native write.', { ...edition, ...mapping, dssId: id, expectedPlanSha256: digest }, ['workspace','editionId','dssId','expectedPlanSha256'], { idempotent: true }),
    tool('merchant_usgs_dss_operation', 'Read the original saved native operation after restart or a lost response, including completed source identity and paged series.', { ...dss, ...page }, ['workspace','dssId'], read),
    tool('merchant_usgs_dss_runtime', 'Probe the original configured official hecdss interpreter and native library.', selection, ['workspace'], { idempotent: true }),
    tool('merchant_usgs_dss_verify', 'Run original native readback against the saved request and DSS file. Progress stays in this original console’s jobs.', dss, ['workspace','dssId'], { idempotent: true }),
    tool('merchant_usgs_dss_handover', 'Prepare or reopen the original complete source/native DSS handover ZIP. Poll its original job and inspect the retained file.', dss, ['workspace','dssId'], { idempotent: true }),
    tool('merchant_usgs_dss_file', 'Inspect the exact retained native DSS, report, mapping, row map, native result, comparison or complete handover.', { ...dss, kind: { type: 'string', enum: DSS_KINDS } }, ['workspace','dssId','kind'], read),
    tool('merchant_usgs_dss_file_read', 'Read a selected original DSS file through the shared verified descriptor reader; no whole-file memory buffer or duplicate snapshot is created.', { ...dss, kind: { type: 'string', enum: DSS_KINDS }, ...chunk }, ['workspace','dssId','kind'], read),
    tool('merchant_usgs_dss_receive', 'Receive a complete declared handover file or another declared project’s original handover at the selected SHA256. Repeating the same package reopens its original edition/export IDs.', { ...selection, file: alias, fromWorkspace: alias, dssId: id, expectedSha256: digest }, ['workspace','expectedSha256'], { idempotent: true }),
    tool('merchant_usgs_file_release', 'Release one original file read owned by this workspace.', { ...selection, readId: { type: 'string', pattern: UUID.source } }, ['workspace','readId'], { idempotent: true }),
    tool('merchant_usgs_delivery_prepare', 'Retain a compact customer manifest for the complete existing native handover. This binds a stable customer delivery ID to the original workspace, source and DSS export.', { ...dss, exportId: alias }, ['workspace','dssId','exportId'], { idempotent: true }),
    tool('merchant_usgs_deliveries', 'Page complete retained customer deliveries, including earlier results whose replies were interrupted.', page, [], read),
    tool('merchant_usgs_delivery_manifest', 'Inspect the original compact customer completion manifest used by the maintained downloader.', { exportId: alias }, ['exportId'], read),
    tool('merchant_usgs_delivery_file', 'Read one exact customer file or its completion manifest at the original manifest/hash/offset using the maintained retained-file protocol.', { exportId: alias, file: { type: 'string', minLength: 1, maxLength: 160 }, expectedManifestSha256: digest, ...chunk }, ['exportId','file','expectedManifestSha256','expectedSha256'], read),
    tool('merchant_usgs_delivery_file_release', 'Release the original customer download descriptor while retaining the complete delivery.', { exportId: alias, readId: { type: 'string', pattern: UUID.source } }, ['exportId','readId'], { idempotent: true }),
  ];
}

export { usgsWorkspaceTools, read, selection, page, id, chunk, analysis, analysisDetail, digest, edition, alias, mapping, dss, DSS_KINDS, UUID, ID, ANALYSIS_VIEWS, SHA, ALIAS };
