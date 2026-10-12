// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const DIGEST = /^[a-f0-9]{64}$/;

const RESEARCH_ID = /^[A-Za-z][A-Za-z0-9_-]{0,100}$/;

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const nativeId = { type: 'string', pattern: RESEARCH_ID.source };

const digest = { type: 'string', pattern: DIGEST.source };

const shortText = { type: 'string', minLength: 1, maxLength: 240 };

const selected = { workspace: alias };

const inEdition = { ...selected, editionId: nativeId };

const inDossier = { ...selected, dossierId: nativeId };

const expectedRevision = { type: 'integer', minimum: 0 };

const offset = { type: 'integer', minimum: 0 };

const pageSize = { type: 'integer', minimum: 1, maximum: 100 };

const page = { offset, limit: pageSize, expectedSnapshot: digest };

const read = { readOnly: true, idempotent: true };

const strings = { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 250 } };

const awardKey = { type: 'string', minLength: 1, maxLength: 250 };

const query = { type: 'object', additionalProperties: false,
  required: ['name', 'startDate', 'endDate'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 },
    startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    dateType: { type: 'string', enum: ['new_awards_only', 'action_date', 'date_signed', 'last_modified_date'] },
    keywords: strings, recipient: strings, awardIds: strings, naics: strings, psc: strings,
    description: { type: 'string', maxLength: 2000 },
    awardTypes: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: ['A', 'B', 'C', 'D'] } },
    agencies: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false,
      required: ['type', 'tier', 'name'], properties: {
        type: { type: 'string', enum: ['awarding', 'funding'] }, tier: { type: 'string', enum: ['toptier', 'subtier'] },
        name: { type: 'string', minLength: 1, maxLength: 200 }, toptier_name: { type: 'string', maxLength: 200 },
      } } },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    maxRows: { type: 'integer', minimum: 1, maximum: 250000 },
    minimumAwardUsd: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maximumAwardUsd: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  } };

const EXPORTS = Object.freeze({
  'edition-json': { ext: 'json', type: 'application/json; charset=utf-8', required: ['editionId'], optional: ['includeReviews'] },
  'edition-csv': { ext: 'csv', type: 'text/csv; charset=utf-8', required: ['editionId'], optional: [] },
  workspace: { ext: 'json', type: 'application/json; charset=utf-8', required: [], optional: [] },
  'source-page': { ext: 'json', type: 'application/json; charset=utf-8', required: ['captureId', 'page'], optional: [] },
  brief: { ext: 'md', type: 'text/markdown; charset=utf-8', required: ['editionId', 'awardKey'], optional: [] },
  comparison: { ext: 'json', type: 'application/json; charset=utf-8', required: ['before', 'after'], optional: [] },
  'dossier-json': { ext: 'json', type: 'application/json; charset=utf-8', required: ['dossierId'], optional: [] },
  'dossier-md': { ext: 'md', type: 'text/markdown; charset=utf-8', required: ['dossierId'], optional: [] },
  'dossier-html': { ext: 'html', type: 'text/html; charset=utf-8', required: ['dossierId'], optional: [] },
  'merchant-csv': { ext: 'csv', type: 'text/csv; charset=utf-8', required: ['merchantId'], optional: [], file: 'awards.csv' },
  'merchant-dataset': { ext: 'json', type: 'application/json; charset=utf-8', required: ['merchantId'], optional: [], file: 'dataset.json' },
  'merchant-source': { ext: 'json', type: 'application/json; charset=utf-8', required: ['merchantId'], optional: [], file: 'source-manifest.json' },
  'merchant-bundle': { ext: 'json', type: 'application/json; charset=utf-8', required: ['merchantId'], optional: [], file: 'bundle.json' },
  'merchant-seller': { ext: 'json', type: 'application/json; charset=utf-8', required: ['merchantId'], optional: [], file: 'seller.json' },
});

const exportKind = { type: 'string', enum: Object.keys(EXPORTS) };

function usaSpendingWorkspaceTools(tool) {
  return [
    tool('merchant_usaspending_workspaces', 'List host-declared award research aliases, original source and delivery handles, browser ownership and retained file reads.', {}, [], read),
    tool('merchant_usaspending_open', 'Open this original private award workspace and its research and dossier browsers. Reopening the owned alias reuses both applications and saved records.', selected, ['workspace'], { idempotent: true }),
    tool('merchant_usaspending_close', 'Close this exact owned instance, pause its original provider jobs, drain active writes and close both browsers. Saved captures, dossiers and complete exports remain available.', {
      ...selected, instanceId: { type: 'string', pattern: UUID.source },
    }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_usaspending_status', 'Read original workspace identity, counts, active capture IDs, browser URLs and native job summaries. Recover lost job replies here before starting another provider operation.', selected, ['workspace'], read),
    tool('merchant_usaspending_inventory', 'Page original queries, captures, editions, reviews, publications or dossiers. Continue with nextOffset and the returned snapshot as expectedSnapshot; a changed inventory requires reopening page zero.', {
      ...selected, kind: { type: 'string', enum: ['queries', 'captures', 'editions', 'reviews', 'publications', 'dossiers'] }, ...page,
    }, ['workspace', 'kind'], read),
    tool('merchant_usaspending_query_save', 'Save an original prime-contract query with optimistic revision checking. Supply queryId and its current revision to edit; omit queryId and use revision zero to create.', {
      ...selected, queryId: nativeId, expectedRevision, definition: query,
    }, ['workspace', 'expectedRevision', 'definition'], {}),
    tool('merchant_usaspending_query', 'Read the complete original saved query and its current revision before capture or editing.', {
      ...selected, queryId: nativeId,
    }, ['workspace', 'queryId'], read),
    tool('merchant_usaspending_capture', 'Start the original native capture job for queryId plus queryRevision, or resume the retained captureId. These selections are mutually exclusive. Returns the original browser job ID; job/status reveal its result, pause, retained pages and provider Retry-After.', {
      ...selected, queryId: nativeId, queryRevision: { type: 'integer', minimum: 1 }, captureId: nativeId,
    }, ['workspace'], { openWorld: true }),
    tool('merchant_usaspending_capture_status', 'Read one original capture, its exact query, provider continuation, retained page/row counts, current edition and recoverable error. Source response bytes are preserved in the complete workspace export.', {
      ...selected, captureId: nativeId,
    }, ['workspace', 'captureId'], read),
    tool('merchant_usaspending_capture_capacity', 'Increase or revise the original paused capture capacity with its exact updated_at value. Retained pages and the original provider continuation remain unchanged.', {
      ...selected, captureId: nativeId, maxRows: { type: 'integer', minimum: 1, maximum: 250000 },
      expectedUpdatedAt: { type: 'string', minLength: 1, maxLength: 40 },
    }, ['workspace', 'captureId', 'maxRows', 'expectedUpdatedAt'], {}),
    tool('merchant_usaspending_job', 'Read one original browser-owned job and its complete native result or error. Capture records remain durable after a process restart; native browser job IDs belong to their original process.', {
      ...selected, jobId: nativeId,
    }, ['workspace', 'jobId'], read),
    tool('merchant_usaspending_pause', 'Pause one original running browser job or active capture. Supply exactly one original jobId or captureId, then inspect its retained state.', {
      ...selected, jobId: nativeId, captureId: nativeId,
    }, ['workspace'], { destructive: true }),
    tool('merchant_usaspending_source_import', 'Import a host-declared original source collection, capture, detail, complete workspace backup or portable dossier through its maintained reader. The source handle selects retained bytes and original hashes, without another provider capture.', {
      ...selected, source: alias, name: shortText, maxRows: { type: 'integer', minimum: 1, maximum: 250000 },
    }, ['workspace', 'source'], {}),
    tool('merchant_usaspending_edition', 'Inspect an immutable edition, exact-value totals, paged recipient groups and original source coverage/warnings. Full rows and source bytes are available through export.', {
      ...inEdition, ...page,
    }, ['workspace', 'editionId'], read),
    tool('merchant_usaspending_rows', 'Browse original edition rows with native field filters and pagination. Preserve the selected editionId while following the native page and total counts.', {
      ...inEdition, search: { type: 'string', maxLength: 1000 }, recipient: { type: 'string', maxLength: 250 },
      recipientUei: { type: 'string', maxLength: 250 }, agency: { type: 'string', maxLength: 250 },
      naics: { type: 'string', maxLength: 100 }, psc: { type: 'string', maxLength: 100 },
      endAfter: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 250 },
    }, ['workspace', 'editionId'], read),
    tool('merchant_usaspending_award', 'Read one original award row, source lineage, detail reference and current analyst review from the selected edition.', {
      ...inEdition, awardKey,
    }, ['workspace', 'editionId', 'awardKey'], read),
    tool('merchant_usaspending_compare', 'Compare two immutable editions using the native exact-value and field-delta engine. Returns totals and a page of changes; export kind=comparison retains every change.', {
      ...selected, before: nativeId, after: nativeId, ...page,
    }, ['workspace', 'before', 'after'], read),
    tool('merchant_usaspending_select', 'Create an immutable selected award edition using the original award keys and name. It retains the original capture and native delivery ancestry.', {
      ...inEdition, awardKeys: { ...strings, minItems: 1, maxItems: 250000, uniqueItems: true }, name: shortText,
    }, ['workspace', 'editionId', 'awardKeys', 'name'], {}),
    tool('merchant_usaspending_enrich', 'Start the original detail-enrichment job for up to 100 selected award keys. Native jobs retain imported detail responses, failures and the resulting enriched edition.', {
      ...inEdition, keys: { ...strings, minItems: 1, uniqueItems: true },
    }, ['workspace', 'editionId', 'keys'], { openWorld: true }),
    tool('merchant_usaspending_attach_details', 'Attach previously imported original detail IDs to the selected edition with the native row/source binding checks.', {
      ...inEdition, detailIds: { type: 'array', minItems: 1, maxItems: 1000, uniqueItems: true, items: nativeId },
    }, ['workspace', 'editionId', 'detailIds'], {}),
    tool('merchant_usaspending_review_save', 'Save the complete analyst workshare record against its original award row and current review revision. The native engine requires fit, deliverables and acceptance criteria at the corresponding commercial stages.', {
      ...inEdition, awardKey, expectedRevision,
      review: { type: 'object', description: 'Original review fields: status, fit, workshare, deliverables, acceptance, constraints, feeUsd, durationDays, primeContact, businessFitUrls, owner, caseUrl, notes, nextAction, nextActionDate. Dollar values are decimal strings.' },
    }, ['workspace', 'editionId', 'awardKey', 'expectedRevision', 'review'], {}),
    tool('merchant_usaspending_history', 'Read original review history for one award, or the original operation history. Returns newest-first records up to the explicit native limit.', {
      ...selected, awardKey, limit: { type: 'integer', minimum: 1, maximum: 1000 },
    }, ['workspace'], read),
    tool('merchant_usaspending_merchant_prepare', 'Prepare the selected edition through the original SF30 dataset merchant writer using the host-selected public payment/origin options. Returns a native browser job; inspect its original merchantId before repeating.', inEdition, ['workspace', 'editionId'], {}),
    tool('merchant_usaspending_merchant_preview', 'Read the original prepared dataset with its native filters, cursor and admission. Returns mode=local_dataset_read and the exact snapshot; payment and deployment remain with the existing seller operator.', {
      ...selected, merchantId: nativeId, query: { type: 'object' },
    }, ['workspace', 'merchantId'], read),
    tool('merchant_usaspending_delivery_adopt', 'Adopt this host-selected finalized original SF100 delivery. Verifies every page, chain, output and original intent, then retains its complete native archives in the award workspace.', {
      ...selected, delivery: alias,
    }, ['workspace', 'delivery'], { idempotent: true }),
    tool('merchant_usaspending_dossier_create', 'Create a complete research dossier in this host-selected original dossier store.', {
      ...selected, title: shortText, description: { type: 'string', maxLength: 20000 },
    }, ['workspace', 'title'], {}),
    tool('merchant_usaspending_dossier', 'Read the original dossier overview or a page of questions, editions, sources, findings, revisions or provider usage. Supply revision for stable historical paging.', {
      ...inDossier, revision: { type: 'integer', minimum: 1 },
      section: { type: 'string', enum: ['overview', 'questions', 'editions', 'sources', 'findings', 'revisions', 'providerUsage', 'unavailableSelections'] }, ...page,
    }, ['workspace', 'dossierId'], read),
    tool('merchant_usaspending_dossier_update', 'Update the original dossier title or description with the reviewed current revision.', {
      ...inDossier, expectedRevision, title: shortText, description: { type: 'string', maxLength: 20000 },
    }, ['workspace', 'dossierId', 'expectedRevision'], {}),
    tool('merchant_usaspending_dossier_question', 'Add a research question, or edit the original questionId including its notes and open/answered/parked status. Every write uses the original dossier revision.', {
      ...inDossier, expectedRevision, questionId: nativeId, text: { type: 'string', minLength: 1, maxLength: 4000 },
      notes: { type: 'string', maxLength: 100000 }, status: { type: 'string', enum: ['open', 'answered', 'parked'] },
    }, ['workspace', 'dossierId', 'expectedRevision'], {}),
    tool('merchant_usaspending_dossier_receive', 'Receive the complete selected award edition under one original question, including source pages, detail bodies and any native delivery archives. The original bridge preserves identical per-question replay and import progress.', {
      ...inDossier, editionId: nativeId, questionId: nativeId, expectedRevision, includeReviews: { type: 'boolean', default: false }, label: shortText,
    }, ['workspace', 'dossierId', 'editionId', 'questionId', 'expectedRevision'], { idempotent: true }),
    tool('merchant_usaspending_dossier_evidence', 'Select or annotate an original cited source or a question-specific occurrence. Supply exactly one sourceId or occurrenceId and the reviewed dossier revision.', {
      ...inDossier, expectedRevision, sourceId: nativeId, occurrenceId: nativeId, selected: { type: 'boolean' },
      note: { type: 'string', maxLength: 100000 }, classification: { type: 'string', enum: ['supports', 'contradicts', 'background', 'unreviewed'] },
    }, ['workspace', 'dossierId', 'expectedRevision', 'selected'], {}),
    tool('merchant_usaspending_dossier_finding', 'Add a cited analyst finding under questionId, or update the original findingId. The original engine binds citations to that question and current dossier revision.', {
      ...inDossier, expectedRevision, questionId: nativeId, findingId: nativeId, title: shortText,
      text: { type: 'string', minLength: 1, maxLength: 100000 },
      sourceIds: { type: 'array', maxItems: 1000, uniqueItems: true, items: nativeId },
    }, ['workspace', 'dossierId', 'expectedRevision'], {}),
    tool('merchant_usaspending_dossier_compare', 'Compare two retained revisions through the original dossier comparison engine.', {
      ...inDossier, before: { type: 'integer', minimum: 1 }, after: { type: 'integer', minimum: 1 },
    }, ['workspace', 'dossierId', 'before', 'after'], read),
    tool('merchant_usaspending_export', 'Create and retain a complete native edition, CSV, workspace backup, source response, workshare brief, comparison, merchant file or dossier report. Returns an immutable content-addressed export ID for exact resumable reads across process restarts.', {
      ...selected, kind: exportKind, editionId: nativeId, captureId: nativeId,
      page: { type: 'integer', minimum: 1, maximum: 1000000 }, awardKey, before: nativeId, after: nativeId,
      dossierId: nativeId, merchantId: nativeId, includeReviews: { type: 'boolean', default: false },
    }, ['workspace', 'kind'], {}),
    tool('merchant_usaspending_file_read', 'Read the complete retained export as SHA256-pinned base64 chunks. Continue with the same kind, exportId, readId and nextOffset. After expiry or restart omit readId and retain exportId plus offset.', {
      ...selected, kind: exportKind, exportId: digest, readId: { type: 'string', pattern: UUID.source },
      offset, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind', 'exportId'], read),
    tool('merchant_usaspending_file_release', 'Release one owned temporary file-read snapshot. The complete content-addressed export remains available.', {
      ...selected, readId: { type: 'string', pattern: UUID.source },
    }, ['workspace', 'readId'], read),
  ];
}

export { usaSpendingWorkspaceTools, read, selected, UUID, page, nativeId, expectedRevision, query, alias, shortText, inEdition, awardKey, strings, inDossier, exportKind, digest, offset, pageSize, RESEARCH_ID, EXPORTS, DIGEST };
