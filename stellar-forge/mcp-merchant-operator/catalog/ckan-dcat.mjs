// MIT. DCAT operations on the existing CKAN workspace provider.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

export function dcatWorkspaceDefinitions({ selected, changing, changed, alias, uuid, digest, offset, read, mutation }) {
  const profile = { type: 'string', enum: ['auto', '1.1', '3.0'] };
  const page = { offset, limit: { type: 'integer', minimum: 1, maximum: 100 } };
  const label = { type: 'string', minLength: 1, maxLength: 512 };
  const nullableId = { type: ['string', 'null'], pattern: uuid.pattern };
  const mappings = { type: 'array', items: { type: 'object', additionalProperties: false,
    properties: { source_path: { type: 'string' }, target_path: { type: 'string' },
      source_identifier: {}, target_identifier: {} },
    required: ['source_path', 'target_path', 'source_identifier', 'target_identifier'] } };
  const file = { ...selected, kind: { type: 'string', enum: ['catalog', 'report', 'candidate', 'acquisition-receipt', 'acquisition-response'] }, itemId: uuid };
  const decision = { ...changing, expectedActiveReleaseId: nullableId,
    expectedReviewSha256: digest, expectedCandidateSha256: digest,
    note: { type: 'string', minLength: 1, maxLength: 4096 } };
  return [
    ['merchant_ckan_dcat_source', 'Inspect a saved recurring catalogue source, its exact configuration identity, latest acquired edition and original request history in the current project.', {
      ...selected, sourceId: uuid, acquisitionsOffset: offset, reviewsOffset: offset,
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['workspace', 'sourceId'], read],
    ['merchant_ckan_dcat_source_save', 'Save a complete catalogue acquisition configuration inside the original project. Updates require the inspected configuration SHA256. authTokenEnv names a private host environment value; no credential value enters saved source metadata. The interval controls due selection by the installed CLI; use the existing host scheduler for recurring invocation.', {
      ...changing, sourceId: uuid, expectedSourceSha256: digest, label,
      url: { type: 'string', minLength: 1, maxLength: 4096 }, profile,
      authTokenEnv: { type: ['string', 'null'], maxLength: 128 },
      intervalMinutes: { type: 'integer', minimum: 1, maximum: 525600 },
      timeoutMs: { type: 'integer', minimum: 100, maximum: 300000 },
      maxResponseBytes: { type: 'integer', minimum: 1024, maximum: 134217728 }, enabled: { type: 'boolean' },
    }, [...changed, 'label', 'url'], mutation],
    ['merchant_ckan_dcat_source_acquire', 'Acquire the actual configured catalogue through the original workspace owner. Bind the current source configuration and latest catalogue UUID or null. Retain the request/response history and exact downloaded bytes; conditional unchanged responses remain linked to a verified prior edition. Follow the original acquisition operation and inspect its retained result before preparing a review.', {
      ...changing, sourceId: uuid, expectedSourceSha256: digest, expectedLatestCatalogId: nullableId,
      unconditional: { type: 'boolean' }, onlyIfDue: { type: 'boolean' }, retryOf: uuid,
    }, [...changed, 'sourceId', 'expectedSourceSha256', 'expectedLatestCatalogId'], { ...mutation, openWorld: true }],
    ['merchant_ckan_dcat_source_review_prepare', 'Prepare a complete following-edition review from one acquired catalogue and the explicitly selected accepted predecessor release. Bind source configuration and catalogue hashes. Optionally select exact zero-based identity-mapping indexes from that accepted baseline’s retained report and select this edition’s edited candidate; all decisions are rechecked by the original migration engine. Original reports and prior releases remain available.', {
      ...changing, sourceId: uuid, expectedSourceSha256: digest, expectedLatestCatalogId: uuid,
      baselineReleaseId: nullableId, expectedBaselineSha256: digest, expectedBaselineReviewSha256: digest,
      reuseMappingIndexes: { type: 'array', uniqueItems: true, items: { type: 'integer', minimum: 0 } }, candidateId: uuid, label,
      normalizeV3: { type: 'boolean' }, identityMappings: mappings, mappingsInput: alias, expectedMappingsSha256: digest,
    }, [...changed, 'sourceId', 'expectedSourceSha256', 'expectedLatestCatalogId', 'baselineReleaseId'], mutation],
    ['merchant_ckan_dcat_status', 'Read DCAT catalog editions, complete-review metadata and release history from this same open CKAN workspace. Each collection has its own offset and nextOffset. The original operation ID remains the mutation baseline; completed correction reviews remain inspectable.', {
      ...selected, catalogsOffset: offset, reviewsOffset: offset, releasesOffset: offset,
      sourcesOffset: offset, acquisitionsOffset: offset,
      semanticProfilesOffset: offset, semanticRunsOffset: offset, semanticReviewsOffset: offset,
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['workspace'], read],
    ['merchant_ckan_dcat_import', 'Import one complete original or edited catalog from a host input alias of kind dcat-catalog. First inspect its exact bytes with merchant_ckan_inputs, then bind expectedSha256. Original bytes are retained unchanged; choose auto, 1.1 or 3.0 and an optional source publication URL. Follow the returned original operation and catalogId.', {
      ...changing, input: alias, expectedSha256: digest, label, profile,
      origin: { type: 'string', maxLength: 4096 },
    }, [...changed, 'input', 'expectedSha256'], mutation],
    ['merchant_ckan_dcat_review_prepare', 'Prepare and retain the complete original GSA conversion, schema validation, identifier conservation and field comparison for saved catalog IDs. A 3.0 source is preserved by default. An edited candidate is independently revalidated. Use either exact typed identityMappings or a host dcat-mappings input plus expectedMappingsSha256 for a large mapping file. Follow the original operation; READY and NEEDS_CORRECTION reviews both retain full results.', {
      ...changing, sourceId: uuid, comparisonId: uuid, candidateId: uuid, label,
      normalizeV3: { type: 'boolean' }, identityMappings: mappings,
      mappingsInput: alias, expectedMappingsSha256: digest,
    }, [...changed, 'sourceId'], mutation],
    ['merchant_ckan_dcat_review', 'Inspect one immutable saved migration review without embedding its entire catalog. The summary gives edition/review hashes and section counts. Page validation, conservation findings, exact mappings, original field changes, catalog changes, independent published-edition comparisons, operator edits, inventories and conversion messages. expectedReviewSha256 binds subsequent pages. Unsafe numeric tokens are displayed as exact strings. Oversized rows are explicitly marked and remain complete in the SHA256-pinned original report file.', {
      ...selected, reviewId: uuid, expectedReviewSha256: digest,
      section: { type: 'string', enum: ['summary', 'validation', 'conservation', 'mappings', 'relationships',
        'field_changes', 'catalog_changes', 'comparison_field_changes', 'comparison_catalog_changes',
        'candidate_comparison_field_changes', 'candidate_comparison_catalog_changes',
        'operator_field_changes', 'operator_catalog_changes', 'inventory', 'issues', 'conversion_messages'] },
      edition: { type: 'string', enum: ['source', 'candidate', 'comparison'] }, ...page,
    }, ['workspace', 'reviewId'], read],
    ['merchant_ckan_dcat_files', 'Select a complete retained original catalog, migration report, candidate or current released catalog and return its exact name, size, SHA256 and stable read selection. For current, omit itemId: the result pins the original review candidate so reading can continue after another release is selected. Reports include all original validation exceptions and full typed field values.', {
      ...selected, kind: { type: 'string', enum: ['catalog', 'report', 'candidate', 'current', 'acquisition-receipt', 'acquisition-response'] }, itemId: uuid,
    }, ['workspace', 'kind'], read],
    ['merchant_ckan_dcat_file_read', 'Receive a complete listed catalog, report or candidate in original SHA256-pinned base64 chunks through the existing retained-file reader. Use the stable kind/itemId from dcat_files, expectedSha256, readId and nextOffset; complete the full byte count and digest. The final chunk releases its descriptor. Use merchant_ckan_file_release for an abandoned read.', {
      ...file, expectedSha256: digest, readId: uuid, offset,
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind', 'itemId', 'expectedSha256'], read],
    ['merchant_ckan_dcat_cutover', 'Select the exact reviewed catalog as this workspace release. Bind its review/candidate hashes and current active release ID. The original model requires valid candidate schema and complete record conservation, retains the decision and prior release, and serves that exact data.json. Follow the original operation; use the existing whole-workspace archive to carry originals, review and release history together.', {
      ...decision, reviewId: uuid,
    }, [...changed, 'reviewId', 'expectedActiveReleaseId', 'expectedReviewSha256', 'expectedCandidateSha256', 'note'], mutation],
    ['merchant_ckan_dcat_rollback', 'Restore an earlier retained catalog release through the same original workspace operation. Bind the selected release candidate/review hashes and exact current active release. The original report remains the acceptance source and the new release records its previous and restored-from IDs.', {
      ...decision, releaseId: uuid,
    }, [...changed, 'releaseId', 'expectedActiveReleaseId', 'expectedReviewSha256', 'expectedCandidateSha256', 'note'], mutation],
  ];
}
