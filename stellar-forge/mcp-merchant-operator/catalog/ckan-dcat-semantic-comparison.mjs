// MIT. Saved original RDF graph comparison, impact and portable artifact tools.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

export function dcatSemanticComparisonDefinitions({ selected, changing, changed, uuid, digest, offset, read, mutation }) {
  const page = { offset, limit: { type: 'integer', minimum: 1, maximum: 100 } };
  const files = { ...selected, kind: { type: 'string', enum: ['comparison', 'review', 'artifact'] },
    id: uuid, key: digest };
  return [
    ['merchant_ckan_dcat_semantic_comparison_status', 'Page retained semantic comparisons and their append-only operator decisions in this same project. Select the original source runs through semantic_status and inspect their complete source/profile/snapshot identity before starting a comparison. This status does not run or repeat a native job.', {
      ...selected, comparisonsOffset: offset, reviewsOffset: offset, limit: page.limit,
    }, ['workspace'], read],
    ['merchant_ckan_dcat_semantic_comparison_start', 'Compare an ordered pair of retained immutable snapshots through the original native graph compare engine. Bind both inspected run hashes. Each side must have its actual completed graph.nt and complete provenance even if a later SHACL phase failed. The same run on both sides is permitted; different profiles and base IRIs remain explicit provenance. Empty edge_predicates means all resource edges. Complete graph additions/removals are separate from the bounded impact traversal. The existing catalogue release and JSON edition comparison are unchanged. Returns comparisonId and original operationId; follow comparison_inspect and merchant_ckan_status.', {
      ...changing, beforeRunId: uuid, expectedBeforeRunSha256: digest,
      afterRunId: uuid, expectedAfterRunSha256: digest, retryOf: uuid,
      parameters: { type: 'object', additionalProperties: false, properties: {
        edge_predicates: { type: 'array', maxItems: 256, uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 4096 },
          description: 'Explicit absolute IRIs. An empty array selects all resource edges; the original engine also follows use of a visited predicate IRI.' },
        depth: { type: 'integer', minimum: 0, maximum: 20, default: 2 },
        node_limit: { type: 'integer', minimum: 1, maximum: 100000, default: 100000 },
      } },
      limits: { type: 'object', additionalProperties: false, properties: {
        timeout_seconds: { type: 'integer', minimum: 5, maximum: 600 },
        memory_mib: { type: 'integer', minimum: 256, maximum: 4096 },
      } },
    }, [...changed, 'beforeRunId', 'expectedBeforeRunSha256', 'afterRunId', 'expectedAfterRunSha256'], mutation],
    ['merchant_ckan_dcat_semantic_comparison_inspect', 'Inspect one saved comparison, both exact original run/profile/source/snapshot bindings, native graph-difference and impact results, all original artifacts and human review history. graph_difference_complete and impact_truncated are independent. A limited impact total remains null/unknown; observed_candidate_nodes_at_least is a lower bound. Retain RDF lexical values, datatypes, language and before/after blank-node scope.', {
      ...selected, comparisonId: uuid,
    }, ['workspace', 'comparisonId'], read],
    ['merchant_ckan_dcat_semantic_comparison_rows', 'Read complete original changed statements, impact nodes or traversed relationships in filtered pages. Continue with page.nextOffset. changes and relationships preserve typed RDF triples and original provenance; nodes retain native snapshot_scope and reasons. The graph difference remains complete even when impact is capped. DOWNLOAD_REQUIRED or an oversized row exposes an exact full-file continuation rather than implying an empty complete result. No native comparison is rerun for a page.', {
      ...selected, comparisonId: uuid, section: { type: 'string', enum: ['changes', 'nodes', 'relationships'] },
      ...page, search: { type: 'string', maxLength: 4096 },
      change: { type: 'string', enum: ['added', 'removed'], description: 'Applies only to changes.' },
      snapshot: { type: 'string', enum: ['before', 'after'], description: 'Applies to changes and relationships; nodes retain shared IRI or original blank-node scope.' },
    }, ['workspace', 'comparisonId', 'section'], read],
    ['merchant_ckan_dcat_semantic_comparison_review', 'Append a human decision binding the exact retained comparison and latest decision hash, or explicit null for the first decision. ACCEPT/CHANGES_REQUIRED require a completed original comparison; ACKNOWLEDGE can record a failed or interrupted attempt. Record the observed differences and bounded impact scope in the note. The decision preserves all native evidence and does not select a catalogue release, approve a SHACL/JSON-schema result, or execute payment.', {
      ...changing, comparisonId: uuid, expectedComparisonSha256: digest,
      expectedReviewSha256: { type: ['string', 'null'], pattern: digest.pattern },
      decision: { type: 'string', enum: ['ACCEPT', 'CHANGES_REQUIRED', 'ACKNOWLEDGE'] },
      note: { type: 'string', minLength: 1, maxLength: 4096 },
    }, [...changed, 'comparisonId', 'expectedComparisonSha256', 'expectedReviewSha256', 'decision', 'note'], mutation],
    ['merchant_ckan_dcat_semantic_comparison_files', 'Select a complete retained comparison manifest, append-only comparison review or native artifact and inspect its exact bytes/SHA256. comparison and review use their own id without key. artifact uses comparison id and its returned artifact key. Full additions/removals, typed changes, impact nodes/relationships, provenance, original job and native receipts remain available.', files,
      ['workspace', 'kind', 'id'], read],
    ['merchant_ckan_dcat_semantic_comparison_file_read', 'Receive every byte of a selected original comparison file through the maintained SHA256-pinned retained-file reader. Preserve readId, expectedSha256 and nextOffset through the terminal chunk. Original graph/report/JSONL bytes are unchanged. The final chunk closes the read; use merchant_ckan_file_release for an abandoned handle.', {
      ...files, expectedSha256: digest, readId: uuid, offset,
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind', 'id', 'expectedSha256'], read],
  ];
}
