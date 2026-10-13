// MIT. Complete recipient correction exchange metadata for the original Merchant MCP.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
export function dcatCorrectionExchangeDefinitions({ selected, changing, changed, alias, uuid, digest, offset, read, mutation }) {
  const p = 'merchant_ckan_dcat_correction_exchange_';
  const page = { offset, limit: { type: 'integer', minimum: 1, maximum: 100 } };
  const label = { type: 'string', minLength: 1, maxLength: 512 }, person = { type: 'string', minLength: 1, maxLength: 160 };
  const note = { type: 'string', minLength: 1, maxLength: 8192 };
  const choice = { type: 'object', additionalProperties: false,
    properties: { path: { type: 'string', maxLength: 16384 }, choice: { type: 'string', enum: ['current', 'returned', 'issued'] } },
    required: ['path', 'choice'] };
  const choices = { choices: { type: 'array', maxItems: 10000, items: choice },
    choicesInput: alias, expectedChoicesSha256: digest };
  const selection = { proposalId: uuid, editionId: uuid, expectedRevisionId: uuid, expectedDocumentSha256: digest, ...choices };
  const selectedRequired = ['workspace', 'proposalId', 'editionId', 'expectedRevisionId', 'expectedDocumentSha256'];
  const chunk = { expectedSha256: digest, readId: uuid, offset,
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  const file = { kind: { type: 'string', enum: ['issue', 'recipient', 'initial-proposal', 'proposal', 'decision', 'file'] },
    id: uuid, key: { type: 'string', maxLength: 512 } };
  const metadata = { kind: { type: 'string', enum: ['issue', 'proposal', 'pending'] }, id: uuid };
  const safeMutation = { ...mutation, idempotent: true };
  return [
    [p + 'list', 'Page original issued packages, received proposals or adoption decisions. Includes separately paged pending request identities. This is retained local history; receiving a proposal never edits the author catalogue automatically.', {
      ...selected, ...page, kind: { type: 'string', enum: ['issues', 'proposals', 'decisions'] },
      correctionId: uuid, query: { type: 'string', maxLength: 2000 }, pendingOffset: offset,
    }, ['workspace'], read],
    [p + 'get', 'Inspect one issued package, received proposal or original pending request, with complete metadata download and paged original sections. Issue sections: history, files, proposals. Proposal sections: editions, decisions. Pending requests expose choices plus their complete original request file. Unfinished working edits remain available in full metadata but only saved editions can be reconciled.', {
      ...selected, ...metadata, ...page,
      section: { type: 'string', enum: ['history', 'files', 'proposals', 'editions', 'decisions', 'choices'] },
    }, ['workspace', 'kind', 'id'], read],
    [p + 'metadata_read', 'Read the complete original metadata JSON selected by get, pinned to its inspected SHA256. Follow readId/nextOffset; release abandoned reads with merchant_ckan_file_release. New first reads detect changed metadata rather than substituting another history.', {
      ...selected, ...metadata, ...chunk,
    }, ['workspace', 'kind', 'id', 'expectedSha256'], read],
    [p + 'issue', 'Issue a complete standalone recipient correction package from an exact saved revision. Binds its full document hash, issuer, intended recipient and issue reason. Retains original catalogue/candidate evidence, full selected history and editable HTML. Keep requestId unchanged after an uncertain result; original workspace operation returns exchangeId.', {
      ...changing, requestId: uuid, correctionId: uuid, revisionId: uuid, expectedDocumentSha256: digest,
      issuer: person, recipient: person, label, note,
    }, [...changed, 'requestId', 'correctionId', 'revisionId', 'expectedDocumentSha256', 'issuer', 'recipient', 'label', 'note'], safeMutation],
    [p + 'receive', 'Receive the exact returned JSON or standalone HTML through a host-declared dcat-correction-proposal alias and its full SHA256. Retains the whole file, all saved recipient editions and working edits; validates the original issued package before accepting. No catalogue edit occurs. Keep the same requestId/hash across retries; a relocated same file can use another declared alias.', {
      ...changing, requestId: uuid, input: alias, expectedSha256: digest,
    }, [...changed, 'requestId', 'input', 'expectedSha256'], safeMutation],
    [p + 'preview', 'Compare one saved recipient edition with its exact issued baseline and the inspected current author revision. Supply explicit current/returned/issued choices inline or from a hash-pinned dcat-correction-choices alias; omission means no explicit choices. Page every row. Conflicts require explicit choices; complete and saveable are distinct. previewSha256 binds the whole comparison independently of page. Oversized rows remain in the full original page download.', {
      ...selected, ...selection, ...page,
    }, selectedRequired, read],
    [p + 'preview_read', 'Read one complete untruncated preview page selected by preview. pageOffset/pageLimit select original comparison rows; offset/limit select byte chunks. First read requires the same guard and choices; later readId chunks reuse the bound original snapshot. The complete page-file SHA differs from the whole previewSha256 used for adoption.', {
      ...selected, ...selection, pageOffset: offset, pageLimit: { type: 'integer', minimum: 1, maximum: 100 }, ...chunk,
    }, [...selectedRequired, 'expectedSha256'], read],
    [p + 'apply', 'Adopt the inspected recipient reconciliation as an attributed original correction revision. Requires stable requestId, exact current author revision/document, saved recipient edition, unchanged choices and expectedPreviewSha256. All conflicts must be resolved and resulting operations within the original 1000-operation save limit. Preserves complete issue/proposal/decision custody; materialization and migration review remain separate.', {
      ...changing, ...selection, requestId: uuid, expectedPreviewSha256: digest, author: person, note,
    }, [...new Set([...changed, ...selectedRequired, 'requestId', 'expectedPreviewSha256', 'author', 'note'])], safeMutation],
    [p + 'files', 'Select one complete original exchange file. kind issue/recipient/initial-proposal uses the issued exchange UUID; proposal uses received proposal UUID; decision uses adoption request UUID; file uses issued UUID plus one exact files[].key. Returns full byte count/hash and pinned original reader selection.', {
      ...selected, ...file,
    }, ['workspace', 'kind', 'id'], read],
    [p + 'file_read', 'Read the complete original issue, editable recipient HTML, original return, decision or issued evidence file in pinned base64 chunks. Bind expectedSha256, retain readId and advance nextOffset. The same private file handle remains owned by the original reader. Release abandoned reads with merchant_ckan_file_release.', {
      ...selected, ...file, ...chunk,
    }, ['workspace', 'kind', 'id', 'expectedSha256'], read],
  ];
}
