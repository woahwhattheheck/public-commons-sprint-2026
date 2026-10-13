// MIT. Metadata for the original DCAT correction workspace tools.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

export function dcatCorrectionDefinitions({ selected, changing, changed, alias, uuid, digest, offset, read, mutation }) {
  const prefix = 'merchant_ckan_dcat_correction_';
  const page = { offset, limit: { type: 'integer', minimum: 1, maximum: 100 } };
  const query = { type: 'string', maxLength: 2000 };
  const pointer = { type: 'string', maxLength: 16384 };
  const correction = { ...selected, correctionId: uuid };
  const revision = { ...correction, revisionId: uuid };
  const guard = { ...correction, expectedRevisionId: uuid, expectedDocumentSha256: digest };
  const guarded = ['workspace', 'correctionId', 'expectedRevisionId', 'expectedDocumentSha256'];
  const attribution = { requestId: uuid, author: { type: 'string', minLength: 1, maxLength: 160 },
    note: { type: 'string', minLength: 1, maxLength: 8192 } };
  const attributed = ['requestId', 'author', 'note'];
  const label = { type: 'string', minLength: 1, maxLength: 512 };
  const literal = { type: 'string', description: 'Exact JSON literal text: keep quotes for a JSON string and retain every numeric digit.' };
  const operation = (op, extra, required) => ({ type: 'object', additionalProperties: false,
    properties: { op: { const: op }, path: pointer, ...extra }, required: ['op', 'path', ...required] });
  const edits = {
    operations: { type: 'array', minItems: 1, maxItems: 1000, items: { oneOf: [
      operation('add', { valueText: literal }, ['valueText']),
      operation('replace', { valueText: literal }, ['valueText']),
      operation('remove', {}, []), operation('move', { from: pointer }, ['from']),
    ] } },
    operationsInput: alias, expectedOperationsSha256: digest,
  };
  const chunk = { expectedSha256: digest, readId: uuid, offset,
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  const file = { ...revision, kind: { type: 'string', enum: ['document', 'revision'] } };
  const safeMutation = { ...mutation, idempotent: true };
  return [
    [prefix + 'list', 'List correction drafts with exact current revision/document identities and page retained pending request IDs. query filters draft summaries; pendingOffset independently pages pending admissions. Full history is available through get and metadata_read.', {
      ...selected, ...page, query, pendingOffset: offset,
    }, ['workspace'], read],
    [prefix + 'get', 'Inspect one complete correction identity and page every saved revision and materialization. Returns a SHA256-pinned metadata_read selector for the full history JSON. Oversized displayed rows are explicit; complete metadata remains downloadable.', {
      ...correction, revisionsOffset: offset, materializationsOffset: offset,
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['workspace', 'correctionId'], read],
    [prefix + 'metadata_read', 'Read the full correction metadata/history JSON using its inspected SHA256 and the original retained-file reader. First read binds the current complete metadata; reuse readId, nextOffset and the same hash for all remaining chunks. Close an abandoned read with merchant_ckan_file_release.', {
      ...correction, ...chunk,
    }, ['workspace', 'correctionId', 'expectedSha256'], read],
    [prefix + 'inspect', 'Inspect an exact JSON pointer in a selected saved revision. Returns the JSON type, exact literal when it fits, paged children and the complete source-document download selector. Numeric literals remain text. Large literals are explicitly unavailable in display and remain in the original file.', {
      ...revision, pointer, ...page, query,
    }, ['workspace', 'correctionId'], read],
    [prefix + 'preview', 'Preview ordered edits against the inspected current revision and document SHA256 without saving. Supply exactly one inline operations array or host input alias of kind dcat-corrections with its expected hash. valueText is exact JSON literal text. Returns before/after text, result document hash, paged changes and complete preview download.', {
      ...guard, ...edits, ...page,
    }, guarded, read],
    [prefix + 'preview_read', 'Read the complete preview JSON through the original retained-file reader. On the first read supply the exact same revision guard and operations selection used for preview, plus the inspected preview SHA256. Continuation uses the same guard/hash/readId/nextOffset. The read never saves an edit.', {
      ...guard, ...edits, ...chunk,
    }, [...guarded, 'expectedSha256'], read],
    [prefix + 'create', 'Create a correction draft from one retained catalogue or migration candidate, binding its full SHA256. Use kind catalog with catalogId, or kind candidate with reviewId. Keep requestId and the complete body unchanged after an uncertain result; a completed identical request replays safely. Follow the original workspace operation.', {
      ...changing, ...attribution, kind: { type: 'string', enum: ['catalog', 'candidate'] },
      catalogId: uuid, reviewId: uuid, expectedSha256: digest, label,
    }, [...changed, ...attributed, 'kind', 'expectedSha256', 'label'], safeMutation],
    [prefix + 'save', 'Save ordered exact-text edits as a new revision. Bind the inspected head revision/document hash, retain a stable request UUID and attribution, and optionally bind expectedResultSha256 from preview. Supply inline operations or one SHA256-pinned dcat-corrections input alias. Does not replace the original catalogue or accept a release.', {
      ...changing, ...guard, ...attribution, ...edits, expectedResultSha256: digest,
    }, [...new Set([...changed, ...guarded, ...attributed])], safeMutation],
    [prefix + 'restore', 'Append a new correction revision containing an exact earlier revision document. Requires the current head/document hash and targetRevisionId; preserves later history and the stable request UUID. Follow the original operation and inspect the new revision.', {
      ...changing, ...guard, ...attribution, targetRevisionId: uuid,
    }, [...new Set([...changed, ...guarded, ...attributed, 'targetRevisionId'])], safeMutation],
    [prefix + 'materialize', 'Retain one exact saved correction revision as an ordinary catalogue candidate. Bind revisionId/document SHA256 and keep requestId stable. Returns catalogId through the original operation; prepare an existing migration review separately using that candidate and the draft source migrationSourceId. No release or semantic decision is implied.', {
      ...changing, ...revision, ...attribution, expectedDocumentSha256: digest, label,
      profile: { type: 'string', enum: ['auto', '1.1', '3.0'] },
    }, [...changed, ...attributed, 'correctionId', 'revisionId', 'expectedDocumentSha256', 'label', 'profile'], safeMutation],
    [prefix + 'files', 'Select an original correction document or full revision record. An omitted revision selects the current head once; the returned file_read selector pins its exact revision UUID, byte count and SHA256.', file,
      ['workspace', 'correctionId', 'kind'], read],
    [prefix + 'file_read', 'Read the exact saved document or revision record in pinned base64 chunks. Use the complete files selector with revisionId, expectedSha256, readId and nextOffset. The original read-only descriptor is retained across chunks; merchant_ckan_file_release closes an abandoned read.', {
      ...file, ...chunk,
    }, ['workspace', 'correctionId', 'revisionId', 'kind', 'expectedSha256'], read],
  ];
}
