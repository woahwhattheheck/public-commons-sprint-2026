// MIT. Complete semantic profile, native run and original artifact handover tools.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

export function dcatSemanticDefinitions({ selected, changing, changed, alias, uuid, digest, offset, read, mutation }) {
  const page = { offset, limit: { type: 'integer', minimum: 1, maximum: 100 } };
  const label = { type: 'string', minLength: 1, maxLength: 512 };
  const graphFormat = { type: 'string', enum: ['turtle', 'nt', 'xml', 'json-ld'] };
  const file = { input: alias, expectedSha256: digest, name: label };
  const contextFile = { type: 'object', additionalProperties: false, properties: file,
    required: ['input', 'expectedSha256'] };
  const graphFile = { type: 'object', additionalProperties: false, properties: { ...file, format: graphFormat },
    required: ['input', 'expectedSha256', 'format'] };
  const attachment = { type: 'object', additionalProperties: false,
    properties: { ...file, mediaType: { type: 'string', minLength: 1, maxLength: 128 } },
    required: ['input', 'expectedSha256'] };
  const fileSelection = { ...selected,
    kind: { type: 'string', enum: ['profile', 'profile-file', 'run', 'review', 'artifact'] },
    id: uuid, key: { type: 'string', pattern: '^(?:[a-f0-9]{64}|[a-z]+(?:-[0-9]+)?)$' } };
  return [
    ['merchant_ckan_dcat_semantic_status', 'Read retained semantic profiles, native runs and append-only operator decisions in this same DCAT project. Each collection has its own offset and nextOffset. Native SHACL conformance, declared class presence, full target coverage and ordinary JSON-schema/conservation review remain separate facts.', {
      ...selected, profilesOffset: offset, runsOffset: offset, reviewsOffset: offset,
      limit: page.limit,
    }, ['workspace'], read],
    ['merchant_ckan_dcat_semantic_profile_import', 'Retain one explicit complete semantic profile from original host input aliases. Use merchant_ckan_inputs to inspect each exact SHA256 first. Context is a complete local JSON document whose sole root key is @context; shapes and optional ontologies are original RDF graph files. Attach original binding audits, licenses or source manifests as nonexecuted files. Explicit baseIRI and contextMode bind the derived graph selection. Replacing a root context never changes the retained catalogue bytes. No remote context or automatic imports are fetched. Maximum64 files,64MiB per file and128MiB in total. This creates a new immutable profile; supersedesProfileId records its predecessor.', {
      ...changing, label, context: contextFile,
      shapes: { type: 'array', minItems: 1, maxItems: 63, items: graphFile },
      ontologies: { type: 'array', maxItems: 62, items: graphFile },
      attachments: { type: 'array', maxItems: 62, items: attachment },
      baseIRI: { type: 'string', minLength: 1, maxLength: 4096 },
      contextMode: { type: 'string', enum: ['require-absent', 'replace-root', 'preserve'] },
      coverageClasses: { type: 'array', maxItems: 256, uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 4096 },
        description: 'Explicit class IRIs whose presence is queried in the retained snapshot. These counts do not measure all SHACL focus targets.' },
      parameters: { type: 'object', additionalProperties: false, properties: {
        inference: { type: 'string', enum: ['none', 'rdfs', 'owlrl', 'both'] },
        allow_infos: { type: 'boolean' }, allow_warnings: { type: 'boolean' },
      } },
      supersedesProfileId: uuid,
    }, [...changed, 'label', 'context', 'shapes', 'baseIRI', 'contextMode'], mutation],
    ['merchant_ckan_dcat_semantic_profile', 'Inspect one saved profile, exact profileSha256, context policy, base IRI, shape/ontology selections and retained audit/source attachments. Download original files with semantic_files kind profile-file and the returned stable key; a profile supersession does not replace previous source.', {
      ...selected, profileId: uuid,
    }, ['workspace', 'profileId'], read],
    ['merchant_ckan_dcat_semantic_run_start', 'Run the original pinned semantic engine on exactly one retained catalogue or the candidate of an original migration review. Bind the selected original document SHA256 and exact profileSha256. Returns its original runId and operationId; follow semantic_run and merchant_ckan_status. A complete nonconforming or invalid-shape result remains a retained native result, while process errors/interruption remain distinguishable. retryOf records a new attempt against an existing run. Each selected original or derived semantic graph input is limited to 64 MiB. This never changes the active catalogue release.', {
      ...changing, profileId: uuid, expectedProfileSha256: digest,
      catalogId: uuid, reviewId: uuid, expectedSourceSha256: digest, retryOf: uuid,
      limits: { type: 'object', additionalProperties: false, properties: {
        timeout_seconds: { type: 'integer', minimum: 5, maximum: 600 },
        memory_mib: { type: 'integer', minimum: 256, maximum: 4096 },
      } },
    }, [...changed, 'profileId', 'expectedProfileSha256', 'expectedSourceSha256'], mutation],
    ['merchant_ckan_dcat_semantic_run', 'Read the original semantic run, retained source/profile binding, full native summary, coverage qualifications, warnings, artifacts and operator-review history. RDF term kind, lexical value, datatype and language remain distinguishable. Complete raw graph, provenance, SHACL report and finding files remain downloadable even when their display is large.', {
      ...selected, runId: uuid,
    }, ['workspace', 'runId'], read],
    ['merchant_ckan_dcat_semantic_findings', 'Page the complete saved native findings, optionally filtering severity and text. Continue with page.nextOffset. Original RDF predicates and term values remain data; display paging never changes the retained report. An oversized row directs you to the complete original findings artifact through the retained reader. No finding count is presented as SHACL target coverage.', {
      ...selected, runId: uuid, ...page, severity: { type: 'string', maxLength: 4096 },
      search: { type: 'string', maxLength: 2048 },
    }, ['workspace', 'runId'], read],
    ['merchant_ckan_dcat_semantic_review', 'Append an operator decision on the exact saved semantic run. ACCEPT and CHANGES_REQUIRED require a completed native attempt; ACKNOWLEDGE may also retain a failed or interrupted attempt. expectedReviewSha256 must be null for the first decision or the latest inspected review hash. ACCEPT, CHANGES_REQUIRED and ACKNOWLEDGE preserve native conformance and do not rewrite findings, approve a JSON-schema review, select a catalogue release or execute payment.', {
      ...changing, runId: uuid, expectedRunSha256: digest,
      expectedReviewSha256: { type: ['string', 'null'], pattern: digest.pattern },
      decision: { type: 'string', enum: ['ACCEPT', 'CHANGES_REQUIRED', 'ACKNOWLEDGE'] },
      note: { type: 'string', minLength: 1, maxLength: 4096 },
    }, [...changed, 'runId', 'expectedRunSha256', 'expectedReviewSha256', 'decision', 'note'], mutation],
    ['merchant_ckan_dcat_semantic_files', 'Select one complete retained semantic manifest or original file and obtain its exact bytes/SHA256 and stable read selection. Kinds profile/run/review use only their original id. profile-file uses profile id plus its retained file key; artifact uses run id plus its retained artifact key. Profile-file keys are original role keys such as context or shape-0; artifact keys are SHA256 identifiers derived from original relative paths. Use the returned key.', fileSelection,
      ['workspace', 'kind', 'id'], read],
    ['merchant_ckan_dcat_semantic_file_read', 'Receive the entire selected semantic file in SHA256-pinned base64 chunks through the original native retained-file reader. Reuse readId, expectedSha256 and nextOffset. The final chunk releases its handle; merchant_ckan_file_release closes an abandoned read. Raw catalogue, profile, graph and report bytes are unchanged.', {
      ...fileSelection, expectedSha256: digest, readId: uuid, offset,
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind', 'id', 'expectedSha256'], read],
  ];
}
