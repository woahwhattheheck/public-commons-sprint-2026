// MIT. Original catalogue correction issue/return custody and author reconciliation.
import { join } from 'node:path';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { object, bytes, digest, identity, readPrivate, privateDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { renderDcatCorrectionRecipient } from './dcat-correction-recipient.mjs';
import { validateCorrectionIssue, validateCorrectionProposal, newCorrectionProposal, readCorrectionProposalFile,
  compareCorrectionProposal, correctionExchangeCanonical, correctionExchangeBytes, EXCHANGE_LIMITS, ISSUE_SCHEMA }
  from './public/dcat-correction-exchange.mjs';
const SCHEMA = 'stellar-forge.dcat-correction-exchanges.v1', DECISION = 'stellar-forge.dcat-correction-adoption.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const need = (ok, code, message = code, status = 400) => { if (!ok) throw fault(code, message, status); };
const text = (value, max = 512) => { need(typeof value === 'string' && value.trim() && value.length <= max,
  'DCAT_EXCHANGE_TEXT_INVALID'); return value.trim(); };
const copy = x => structuredClone(x), hash = async raw => digest(raw);
const root = directory => join(directory, 'dcat', 'corrections', 'exchanges');
const location = (directory, kind, id) => {
  need(['issues', 'proposals', 'decisions'].includes(kind) && UUID.test(id ?? ''), 'DCAT_EXCHANGE_ITEM_INVALID');
  return join(root(directory), kind, id);
};
function stateOf(state) { return state?.corrections?.exchanges; }
function item(state, kind, id) {
  need(UUID.test(id ?? ''), 'DCAT_EXCHANGE_ITEM_NOT_FOUND', 'Select a retained issue, proposal or decision.', 404);
  const row = stateOf(state)?.[kind]?.find(x => x.id === id);
  need(row, 'DCAT_EXCHANGE_ITEM_NOT_FOUND', 'Select a retained issue, proposal or decision.', 404); return row;
}
function draftOf(state, id) {
  const row = state.corrections.drafts.find(x => x.id === id);
  need(row, 'DCAT_CORRECTION_NOT_FOUND', 'Select the original correction draft.', 404); return row;
}
function revisionOf(draft, id) {
  const row = draft.revisions.find(x => x.id === id);
  need(row, 'DCAT_CORRECTION_REVISION_NOT_FOUND', 'Select an original saved correction revision.', 404); return row;
}
async function checkedFile(file, sha, count, maximum = EXCHANGE_LIMITS.packageBytes) {
  const raw = await readPrivate(file, maximum);
  need(raw.length === count && digest(raw) === sha, 'DCAT_EXCHANGE_FILE_CHANGED', 'A complete retained file no longer matches its declared bytes.', 409);
  return raw;
}
function json(raw) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)); }
  catch { throw fault('DCAT_EXCHANGE_JSON_INVALID'); }
}
function utf8(raw) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
  catch { throw fault('DCAT_EXCHANGE_UTF8_INVALID'); }
}
async function revisionFiles(directory, draft, revision) {
  const path = join(directory, 'dcat', 'corrections', draft.id, 'revisions', revision.id);
  const raw = await checkedFile(join(path, 'revision.json'), revision.sha256, revision.bytes, 33554432);
  const document = await checkedFile(join(path, 'document.json'), revision.documentSha256, revision.documentBytes, 134217728);
  const record = json(raw);
  need(record.id === revision.id && record.correctionId === draft.id &&
    record.documentSha256 === revision.documentSha256 && record.documentBytes === revision.documentBytes,
    'DCAT_EXCHANGE_REVISION_CHANGED');
  return { raw, document, record, text: utf8(document) };
}
async function retainExact(file, content) {
  const handle = await open(file, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) && stat.size <= content.length, 'DCAT_EXCHANGE_PARTIAL_CHANGED');
    const old = Buffer.alloc(stat.size); let at = 0;
    while (at < old.length) { const result = await handle.read(old, at, old.length - at, at); need(result.bytesRead > 0, 'DCAT_EXCHANGE_PARTIAL_CHANGED'); at += result.bytesRead; }
    need(old.equals(content.subarray(0, old.length)), 'DCAT_EXCHANGE_PARTIAL_CHANGED', 'Resume only the exact retained request and original bytes.', 409);
    while (at < content.length) { const result = await handle.write(content, at, content.length - at, at); need(result.bytesWritten > 0, 'DCAT_EXCHANGE_WRITE_FAILED'); at += result.bytesWritten; }
    await handle.sync();
  } finally { await handle.close(); }
}
export function validateDcatCorrectionExchanges(state) {
  const current = stateOf(state); if (!current) return;
  need(object(current) && current.schema === SCHEMA && ['issues', 'proposals', 'decisions', 'pending'].every(k => Array.isArray(current[k])),
    'DCAT_EXCHANGE_STATE_INVALID');
  const requests = new Set();
  for (const kind of ['issues', 'proposals', 'decisions']) {
    for (const row of current[kind]) {
      need(object(row) && UUID.test(row.id ?? '') && row.requestId === row.id && HASH.test(row.requestSha256 ?? '') &&
        HASH.test(row.sha256 ?? '') && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= EXCHANGE_LIMITS.packageBytes &&
        !requests.has(row.id), 'DCAT_EXCHANGE_STATE_INVALID');
      requests.add(row.id);
      if (kind === 'issues') {
        const draft = draftOf(state, row.correctionId), revision = revisionOf(draft, row.revisionId);
        need(HASH.test(row.packageSha256 ?? '') && row.documentSha256 === revision.documentSha256 &&
          row.revisionSha256 === revision.sha256, 'DCAT_EXCHANGE_ISSUE_BINDING');
      } else if (kind === 'proposals') {
        const issue = item(state, 'issues', row.exchangeId);
        need(row.packageSha256 === issue.packageSha256 && row.correctionId === issue.correctionId && UUID.test(row.senderProposalId ?? '') &&
          Array.isArray(row.editions), 'DCAT_EXCHANGE_PROPOSAL_BINDING');
      } else {
        const proposal = item(state, 'proposals', row.proposalId), draft = draftOf(state, row.correctionId);
        need(item(state, 'issues', proposal.exchangeId).correctionId === draft.id &&
          HASH.test(row.previewSha256 ?? '') && revisionOf(draft, row.revisionId).documentSha256 === row.documentSha256,
          'DCAT_EXCHANGE_DECISION_BINDING');
      }
    }
  }
  const pending = new Set();
  for (const row of current.pending) {
    need(object(row) && UUID.test(row.id ?? '') && !pending.has(row.id) && HASH.test(row.requestSha256 ?? '') &&
      ['issue', 'receive', 'apply'].includes(row.kind) && typeof row.createdAt === 'string', 'DCAT_EXCHANGE_PENDING_INVALID');
    pending.add(row.id);
    if (row.request !== undefined) {
      need(object(row.request) && row.request.requestId === row.id &&
        identity({ kind: row.kind, input: row.request }) === row.requestSha256,
        'DCAT_EXCHANGE_PENDING_REQUEST_CHANGED');
      if (row.kind === 'receive') need(Object.keys(row.request).every(key =>
        ['requestId', 'expectedSha256'].includes(key)) && HASH.test(row.request.expectedSha256 ?? ''),
        'DCAT_EXCHANGE_PENDING_REQUEST_CHANGED');
    }
    if (row.correctionId !== undefined) {
      draftOf(state, row.correctionId);
      if (row.request && row.kind === 'issue') need(row.request.correctionId === row.correctionId,
        'DCAT_EXCHANGE_PENDING_REQUEST_CHANGED');
      if (row.request && row.kind === 'apply') need(
        item(state, 'proposals', row.request.proposalId).correctionId === row.correctionId,
        'DCAT_EXCHANGE_PENDING_REQUEST_CHANGED');
    }
    // A retained revision/decision may precede final checkpoint persistence; its exact request is resumable.
    if (requests.has(row.id)) {
      const prior = ['issues', 'proposals', 'decisions'].flatMap(k => current[k]).find(x => x.id === row.id);
      need(prior.requestSha256 === row.requestSha256, 'DCAT_EXCHANGE_REQUEST_CHANGED');
    }
  }
}
async function issueFile(directory, state, id) {
  const record = item(state, 'issues', id), raw = await checkedFile(join(location(directory, 'issues', id), 'issue.json'), record.sha256, record.bytes);
  const value = json(raw), checked = await validateCorrectionIssue(value, hash);
  need(value.id === record.id && value.packageSha256 === record.packageSha256 &&
    value.baseline.correctionId === record.correctionId && value.baseline.revisionId === record.revisionId &&
    value.baseline.revisionSha256 === record.revisionSha256 && value.baseline.documentSha256 === record.documentSha256,
    'DCAT_EXCHANGE_ISSUE_BINDING');
  need(value.createdAt === record.createdAt && value.label === record.label && value.issuer === record.issuer &&
    value.recipient === record.recipient && value.note === record.note, 'DCAT_EXCHANGE_ISSUE_METADATA');
  const initialRaw = await checkedFile(join(location(directory, 'issues', id), 'initial-proposal.json'),
    record.initialProposalSha256, record.initialProposalBytes);
  const initial = json(initialRaw), initialChecked = await validateCorrectionProposal(initial, hash);
  need(initial.proposalId === value.id && initial.createdAt === value.createdAt && initial.editions.length === 0 && initial.draft.author === value.recipient && initial.draft.note === '' &&
    initial.draft.operations.length === 0 && correctionExchangeCanonical(initial.draft.editor) ===
      correctionExchangeCanonical({ op: 'replace', path: '', from: '', valueText: '' }) &&
    correctionExchangeCanonical(initial.issue) === correctionExchangeCanonical(value), 'DCAT_EXCHANGE_INITIAL_PROPOSAL_CHANGED');
  const html = await checkedFile(join(location(directory, 'issues', id), 'recipient.html'),
    record.recipientSha256, record.recipientBytes);
  need(correctionExchangeCanonical(readCorrectionProposalFile(html)) === correctionExchangeCanonical(initial),
    'DCAT_EXCHANGE_RECIPIENT_CHANGED');
  return { record, raw, value, checked, initial, initialRaw, html };
}
async function proposalFile(directory, state, id) {
  const record = item(state, 'proposals', id), raw = await checkedFile(join(location(directory, 'proposals', id), 'original.bin'), record.sha256, record.bytes);
  const value = readCorrectionProposalFile(raw), checked = await validateCorrectionProposal(value, hash);
  const issue = item(state, 'issues', record.exchangeId);
  need(value.issue.id === issue.id && value.issue.packageSha256 === issue.packageSha256 &&
    value.proposalId === record.senderProposalId && value.createdAt === record.proposalCreatedAt &&
    record.format === (utf8(raw).trimStart().startsWith('{') ? 'json' : 'html') &&
    identity(value.editions.map(editionSummary)) === identity(record.editions),
    'DCAT_EXCHANGE_PROPOSAL_BINDING');
  return { record, raw, value, checked };
}
function editionSummary(value) {
  const { id, previousId, previousSha256, editionSha256, documentSha256, documentBytes, createdAt, author, note } = value;
  return { id, previousId, previousSha256, editionSha256, documentSha256, documentBytes, createdAt, author, note };
}
async function buildPreview(directory, state, input, enforceHead = true) {
  const proposal = await proposalFile(directory, state, input.proposalId);
  const issue = await issueFile(directory, state, proposal.record.exchangeId);
  const draft = draftOf(state, issue.record.correctionId), current = revisionOf(draft, input.expectedRevisionId);
  need(input.expectedDocumentSha256 === current.documentSha256 && (!enforceHead || draft.headRevisionId === current.id),
    'DCAT_CORRECTION_REVISION_CHANGED', 'Inspect the current author revision before accepting returned catalogue edits.', 409);
  const selected = proposal.checked.editions.get(input.editionId);
  need(selected, 'DCAT_EXCHANGE_EDITION_NOT_FOUND', 'Select a saved recipient edition; unfinished working edits are retained separately.', 404);
  const baseIndex = draft.revisions.findIndex(x => x.id === issue.record.revisionId),
    currentIndex = draft.revisions.findIndex(x => x.id === current.id);
  need(baseIndex >= 0 && currentIndex >= baseIndex, 'DCAT_EXCHANGE_BASELINE_HISTORY');
  const currentHistory = [];
  for (const revision of draft.revisions.slice(baseIndex + 1, currentIndex + 1)) {
    const read = await revisionFiles(directory, draft, revision);
    currentHistory.push({ kind: read.record.kind, operations: read.record.operations, ...(read.record.kind === 'restore' ? { text: read.text } : {}) });
  }
  const returnedIndex = proposal.value.editions.findIndex(x => x.id === input.editionId),
    returnedHistory = proposal.value.editions.slice(0, returnedIndex + 1).map(x => ({ kind: 'edit', operations: x.operations }));
  const currentFile = await revisionFiles(directory, draft, current);
  const result = compareCorrectionProposal({ issuedText: issue.checked.text, currentText: currentFile.text,
    returnedText: selected.text, currentHistory, returnedHistory, choices: input.choices ?? [] });
  const document = result.complete ? Buffer.from(result.mergedText, 'utf8') : null;
  const binding = { correctionId: draft.id, exchangeId: issue.record.id, packageSha256: issue.record.packageSha256,
    proposalId: proposal.record.id, proposalSha256: proposal.record.sha256, editionId: selected.edition.id,
    editionSha256: selected.edition.editionSha256, issuedRevisionId: issue.record.revisionId,
    issuedDocumentSha256: issue.record.documentSha256, currentRevisionId: current.id,
    currentRevisionSha256: current.sha256, currentDocumentSha256: current.documentSha256,
    returnedDocumentSha256: selected.edition.documentSha256, choices: copy(input.choices ?? []),
    documentSha256: document ? digest(document) : null, documentBytes: document?.length ?? null };
  const previewSha256 = identity({ ...binding, rows: result.rows, operations: result.operations,
    complete: result.complete, arrayPolicy: result.arrayPolicy });
  return { proposal, issue, draft, current, result, binding, previewSha256, document };
}
function savedInput(input, correctionId) {
  return { requestId: input.requestId, correctionId, expectedRevisionId: input.expectedRevisionId,
    expectedDocumentSha256: input.expectedDocumentSha256, author: input.author, note: input.note, operations: [],
    exchange: { proposalId: input.proposalId, editionId: input.editionId, expectedPreviewSha256: input.expectedPreviewSha256, choices: input.choices ?? [] } };
}
export async function validateDcatCorrectionExchangeFiles(directory, state) {
  validateDcatCorrectionExchanges(state);
  const current = stateOf(state); if (!current) return;
  for (const row of current.issues) {
    const read = await issueFile(directory, state, row.id), draft = draftOf(state, row.correctionId);
    const selected = revisionOf(draft, row.revisionId), upto = draft.revisions.findIndex(x => x.id === selected.id);
    need(read.value.history.length === upto + 1 && identity(read.value.baseline.source) === identity(draft.source), 'DCAT_EXCHANGE_HISTORY_BINDING');
    for (let i = 0; i <= upto; i++) {
      const original = draft.revisions[i], enclosed = read.value.history[i];
      need(enclosed.id === original.id && enclosed.sha256 === original.sha256 && enclosed.documentSha256 === original.documentSha256,
        'DCAT_EXCHANGE_HISTORY_BINDING');
    }
    const catalog = state.catalogs.find(x => x.id === draft.source.migrationSourceId),
      originalCatalog = read.value.files.find(x => x.key === 'original-catalog');
    need(catalog && originalCatalog?.sha256 === catalog.sha256 && originalCatalog.bytes === catalog.bytes,
      'DCAT_EXCHANGE_ORIGINAL_CATALOG_CHANGED');
    if (draft.source.kind === 'candidate') {
      const review = state.reviews.find(x => x.id === draft.source.id),
        originalReview = read.value.files.find(x => x.key === 'original-review');
      need(review && originalReview?.sha256 === review.reportSha256 && originalReview.bytes === review.reportBytes,
        'DCAT_EXCHANGE_ORIGINAL_REVIEW_CHANGED');
    }
    for (const file of read.value.files) await checkedFile(join(location(directory, 'issues', row.id), 'files', file.sha256),
      file.sha256, file.bytes, EXCHANGE_LIMITS.fileBytes);
  }
  for (const row of current.proposals) {
    const proposal = await proposalFile(directory, state, row.id);
    const original = await issueFile(directory, state, proposal.record.exchangeId);
    need(correctionExchangeCanonical(proposal.value.issue) === correctionExchangeCanonical(original.value), 'DCAT_EXCHANGE_ORIGINAL_ISSUE_CHANGED');
  }
  for (const row of current.decisions) {
    const raw = await checkedFile(join(location(directory, 'decisions', row.id), 'decision.json'), row.sha256, row.bytes);
    const record = json(raw);
    need(record.schema === DECISION && record.id === row.id && record.request.requestId === row.id &&
      record.requestSha256 === row.requestSha256 && identity({ kind: 'apply', input: record.request }) === row.requestSha256 &&
      record.correctionId === row.correctionId && record.proposalId === row.proposalId &&
      record.revisionId === row.revisionId && record.createdAt === row.createdAt &&
      record.request.proposalId === row.proposalId && record.request.editionId === row.editionId &&
      record.request.author === row.author && record.request.note === row.note,
      'DCAT_EXCHANGE_DECISION_CHANGED');
    const preview = await buildPreview(directory, state, record.request, false), revision = revisionOf(preview.draft, row.revisionId);
    const source = await revisionFiles(directory, preview.draft, revision);
    need(preview.result.complete && preview.previewSha256 === row.previewSha256 && preview.previewSha256 === record.previewSha256 &&
      identity(preview.binding) === identity(record.binding) && revision.id === record.request.requestId &&
      revision.previousRevisionId === preview.current.id && revision.documentSha256 === preview.binding.documentSha256 &&
      revision.documentSha256 === row.documentSha256 && revision.requestSha256 === identity({ kind: 'edit', input: savedInput(record.request, preview.draft.id) }) &&
      identity(source.record.operations) === identity(preview.result.operations) &&
      source.record.author === record.request.author && source.record.note === record.request.note,
      'DCAT_EXCHANGE_ADOPTION_CHANGED');
  }
}
export function dcatCorrectionExchangeSummary(state, correctionId = null) {
  const current = stateOf(state);
  return current ? { schema: current.schema,
    issues: current.issues.filter(x => !correctionId || x.correctionId === correctionId).map(({ id, sha256, packageSha256, correctionId, revisionId }) => ({ id, sha256, packageSha256, correctionId, revisionId })),
    proposals: current.proposals.filter(x => !correctionId || x.correctionId === correctionId).map(({ id, sha256, exchangeId, senderProposalId }) => ({ id, sha256, exchangeId, senderProposalId })),
    decisions: current.decisions.filter(x => !correctionId || x.correctionId === correctionId).map(({ id, sha256, proposalId, revisionId, previewSha256 }) => ({ id, sha256, proposalId, revisionId, previewSha256 })) } : null;
}
export function createDcatCorrectionExchanges({ directory, state, dcat, corrections, launch, persist, commit }) {
  state.dcat.corrections.exchanges ??= { schema: SCHEMA, issues: [], proposals: [], decisions: [], pending: [] };
  validateDcatCorrectionExchanges(state.dcat);
  const current = state.dcat.corrections.exchanges;
  function shape(kind, input) {
    need(object(input) && UUID.test(input.requestId ?? ''), 'DCAT_EXCHANGE_REQUEST_ID');
    const selectedInput = kind === 'receive' ? { requestId: input.requestId, expectedSha256: input.expectedSha256 } : input;
    const sha = identity({ kind, input: selectedInput });
    for (const collection of ['issues', 'proposals', 'decisions', 'pending']) {
      const prior = current[collection].find(x => x.id === input.requestId);
      if (prior) need(prior.requestSha256 === sha, 'DCAT_EXCHANGE_REQUEST_CHANGED', 'Resume this original request UUID with its complete unchanged input.', 409);
    }
    return sha;
  }
  async function pending(kind, input, requestSha256, receivedCorrectionId = null) {
    let row = current.pending.find(x => x.id === input.requestId);
    const request = kind === 'receive' ? { requestId: input.requestId, expectedSha256: input.expectedSha256 } : copy(input);
    const correctionId = kind === 'issue' ? input.correctionId : kind === 'apply' ?
      item(state.dcat, 'proposals', input.proposalId).correctionId : receivedCorrectionId;
    if (row) {
      need(row.kind === kind && row.requestSha256 === requestSha256 &&
        (row.request === undefined || identity(row.request) === identity(request)) &&
        (row.correctionId === undefined || row.correctionId === correctionId), 'DCAT_EXCHANGE_REQUEST_CHANGED');
      if (row.request !== undefined && row.correctionId !== undefined) return row;
    }
    const selected = { ...(row ?? { id: input.requestId, kind, requestSha256, createdAt: stamp() }), request, correctionId };
    draftOf(state.dcat, correctionId);
    const next = row ? current.pending.map(value => value.id === selected.id ? selected : value) : [...current.pending, selected];
    // Preserve the original workbench's 16 MiB reopen bound before publishing a complete recoverable request.
    const proposed = { ...state, dcat: { ...state.dcat, corrections: {
      ...state.dcat.corrections, exchanges: { ...current, pending: next } } } };
    need(bytes(proposed).length <= 16777216, 'DCAT_EXCHANGE_WORKSPACE_LIMIT',
      'The complete pending request exceeds this workspace capacity. Retain the choices and use a smaller explicit selection.', 413);
    current.pending = next; await persist(); return selected;
  }
  async function finish(id) { current.pending = current.pending.filter(x => x.id !== id); await persist(); }
  async function buildIssue(input, createdAt) {
    const draft = await corrections.dcatCorrection(input.correctionId), selected = revisionOf(draft, input.revisionId);
    need(selected.documentSha256 === input.expectedDocumentSha256, 'DCAT_CORRECTION_REVISION_CHANGED');
    const files = [], blobs = {}; let total = 0;
    const add = (key, name, role, raw) => {
      need(raw.length <= EXCHANGE_LIMITS.fileBytes, 'DCAT_EXCHANGE_FILE_LIMIT');
      const sha256 = digest(raw);
      if (!own(blobs, sha256)) {
        total += raw.length; need(total <= EXCHANGE_LIMITS.uniqueBytes, 'DCAT_EXCHANGE_UNIQUE_SIZE', 'The complete issue exceeds 128 MiB of unique source bytes.');
        blobs[sha256] = { bytes: raw.length, contentBase64: raw.toString('base64') };
      }
      files.push({ key, name, role, bytes: raw.length, sha256 }); return key;
    };
    const history = [];
    for (const revision of draft.revisions.slice(0, draft.revisions.findIndex(x => x.id === selected.id) + 1)) {
      const value = await revisionFiles(directory, draft, revision);
      const documentKey = add('document:' + revision.id, 'revision-' + revision.id + '.json', 'revision-document', value.document),
        recordKey = add('record:' + revision.id, 'history-' + revision.id + '.json', 'revision-record', value.raw);
      history.push({ ...copy(revision), documentKey, recordKey });
    }
    const original = await dcat.dcatCatalogDownload(draft.source.migrationSourceId);
    add('original-catalog', 'original-catalog.json', 'original-catalog',
      await checkedFile(original.file, original.sha256, original.bytes, EXCHANGE_LIMITS.fileBytes));
    if (draft.source.kind === 'candidate') {
      const report = await dcat.dcatReviewDownload(draft.source.id, 'report');
      add('original-review', 'original-review.json', 'original-review',
        await checkedFile(report.file, report.sha256, report.bytes, EXCHANGE_LIMITS.fileBytes));
    }
    const value = { schema: ISSUE_SCHEMA, id: input.requestId, createdAt,
      label: text(input.label), issuer: text(input.issuer, 160), recipient: text(input.recipient, 160), note: text(input.note, 8192),
      baseline: { correctionId: draft.id, revisionId: selected.id, revisionSha256: selected.sha256,
        documentSha256: selected.documentSha256, documentBytes: selected.documentBytes, source: copy(draft.source) },
      history, files, blobs };
    value.packageSha256 = identity(value);
    await validateCorrectionIssue(value, hash);
    const raw = bytes(value); need(raw.length <= EXCHANGE_LIMITS.packageBytes, 'DCAT_EXCHANGE_PACKAGE_LIMIT');
    return { value, raw };
  }
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  return {
    listDcatCorrectionExchanges({ kind = 'issues', offset = 0, limit = 30, query = '', correctionId = null } = {}) {
      need(['issues', 'proposals', 'decisions'].includes(kind) && Number.isSafeInteger(offset) && offset >= 0 &&
        Number.isSafeInteger(limit) && limit > 0 && limit <= 200 && typeof query === 'string' && query.length <= 2000,
        'DCAT_EXCHANGE_PAGE_INVALID');
      const needle = query.toLocaleLowerCase(), rows = current[kind].filter(x => (!correctionId || x.correctionId === correctionId) &&
        (!needle || JSON.stringify(x).toLocaleLowerCase().includes(needle)));
      return { kind, offset, limit, total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null,
        rows: copy(rows.slice(offset, offset + limit)) };
    },
    async dcatCorrectionExchange(id) {
      const read = await issueFile(directory, state.dcat, id);
      return { ...copy(read.record), baseline: copy(read.value.baseline), files: copy(read.value.files),
        history: copy(read.value.history), proposals: copy(current.proposals.filter(x => x.exchangeId === id)) };
    },
    async dcatCorrectionProposal(id) {
      const read = await proposalFile(directory, state.dcat, id);
      return { ...copy(read.record), draft: copy(read.value.draft), issue: copy(item(state.dcat, 'issues', read.record.exchangeId)),
        decisions: copy(current.decisions.filter(x => x.proposalId === id)) };
    },
    issueDcatCorrectionExchange(input) {
      const requestSha256 = shape('issue', input), id = input.requestId, prior = current.issues.find(x => x.id === id);
      text(input.label); text(input.issuer, 160); text(input.recipient, 160); text(input.note, 8192);
      return { ...launch(prior ? 'reopen issued catalogue correction' : 'issue catalogue correction for recipient', async () => {
        if (prior) { await issueFile(directory, state.dcat, id); await finish(id); return copy(prior); }
        const journal = await pending('issue', input, requestSha256), built = await buildIssue(input, journal.createdAt);
        const initial = await newCorrectionProposal(built.value, { proposalId: id, createdAt: journal.createdAt, author: built.value.recipient }, hash);
        const initialRaw = bytes(initial), rendered = await renderDcatCorrectionRecipient({ issue: built.value, proposal: initial });
        need(typeof rendered === 'string', 'DCAT_EXCHANGE_RECIPIENT_RENDER_INVALID');
        const html = Buffer.from(rendered, 'utf8');
        need(initialRaw.length <= EXCHANGE_LIMITS.packageBytes && html.length <= EXCHANGE_LIMITS.packageBytes,
          'DCAT_EXCHANGE_PACKAGE_LIMIT');
        need(correctionExchangeCanonical(readCorrectionProposalFile(html)) === correctionExchangeCanonical(initial),
          'DCAT_EXCHANGE_RECIPIENT_CHANGED');
        const path = location(directory, 'issues', id); await privateDirectory(join(path, 'files'), true);
        for (const [sha, blob] of Object.entries(built.value.blobs)) await retainExact(join(path, 'files', sha), Buffer.from(blob.contentBase64, 'base64'));
        await retainExact(join(path, 'issue.json'), built.raw);
        await retainExact(join(path, 'initial-proposal.json'), initialRaw);
        await retainExact(join(path, 'recipient.html'), html);
        const record = { id, requestId: id, requestSha256, createdAt: journal.createdAt, sha256: digest(built.raw), bytes: built.raw.length,
          initialProposalSha256: digest(initialRaw), initialProposalBytes: initialRaw.length,
          recipientSha256: digest(html), recipientBytes: html.length,
          packageSha256: built.value.packageSha256, correctionId: input.correctionId, revisionId: input.revisionId,
          revisionSha256: built.value.baseline.revisionSha256, documentSha256: built.value.baseline.documentSha256,
          label: built.value.label, issuer: built.value.issuer, recipient: built.value.recipient, note: built.value.note };
        current.issues.push(record); await finish(id); return copy(record);
      }), exchangeId: id, correctionId: input.correctionId };
    },
    receiveDcatCorrectionProposal(input) {
      const requestSha256 = shape('receive', input), id = input.requestId, prior = current.proposals.find(x => x.id === id);
      need(HASH.test(input.expectedSha256 ?? ''), 'DCAT_EXCHANGE_SOURCE_HASH');
      return { ...launch(prior ? 'reopen received catalogue proposal' : 'receive complete catalogue proposal', async () => {
        if (prior) { await proposalFile(directory, state.dcat, id); await finish(id); return copy(prior); }
        const raw = await readPrivate(input.file, EXCHANGE_LIMITS.packageBytes);
        need(digest(raw) === input.expectedSha256, 'DCAT_EXCHANGE_FILE_CHANGED');
        const value = readCorrectionProposalFile(raw), checked = await validateCorrectionProposal(value, hash);
        const original = await issueFile(directory, state.dcat, value.issue.id);
        need(correctionExchangeCanonical(value.issue) === correctionExchangeCanonical(original.value), 'DCAT_EXCHANGE_ORIGINAL_ISSUE_CHANGED');
        const journal = await pending('receive', input, requestSha256, value.issue.baseline.correctionId), path = location(directory, 'proposals', id);
        await privateDirectory(path, true); await retainExact(join(path, 'original.bin'), raw);
        const record = { id, requestId: id, requestSha256, receivedAt: journal.createdAt, sha256: digest(raw), bytes: raw.length,
          exchangeId: value.issue.id, correctionId: value.issue.baseline.correctionId, packageSha256: value.issue.packageSha256,
          senderProposalId: value.proposalId, proposalCreatedAt: value.createdAt,
          format: utf8(raw).trimStart().startsWith('{') ? 'json' : 'html', editions: value.editions.map(editionSummary) };
        current.proposals.push(record); await finish(id); return copy(record);
      }), proposalId: id };
    },
    async previewDcatCorrectionProposal(input) {
      const preview = await buildPreview(directory, state.dcat, input), offset = input.offset ?? 0, limit = input.limit ?? 30;
      need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 200,
        'DCAT_EXCHANGE_PAGE_INVALID');
      return { ...preview.binding, previewSha256: preview.previewSha256, complete: preview.result.complete,
        conflictCount: preview.result.conflictCount, unresolvedCount: preview.result.unresolvedCount,
        operationsCount: preview.result.operations.length, saveable: preview.result.complete && preview.result.operations.length <= EXCHANGE_LIMITS.operations, arrayPolicy: preview.result.arrayPolicy,
        rows: copy(preview.result.rows.slice(offset, offset + limit)),
        page: { offset, limit, total: preview.result.rows.length, nextOffset: offset + limit < preview.result.rows.length ? offset + limit : null } };
    },
    applyDcatCorrectionProposal(input) {
      const requestSha256 = shape('apply', input), id = input.requestId, prior = current.decisions.find(x => x.id === id);
      const proposal = item(state.dcat, 'proposals', input.proposalId), issue = item(state.dcat, 'issues', proposal.exchangeId);
      need(HASH.test(input.expectedPreviewSha256 ?? ''), 'DCAT_EXCHANGE_PREVIEW_HASH');
      need(input.author === text(input.author, 160) && input.note === text(input.note, 8192), 'DCAT_EXCHANGE_ATTRIBUTION');
      const baseInput = savedInput(input, issue.correctionId);
      let prepared = null;
      const result = commit(baseInput, {
        async prepare() {
          await pending('apply', input, requestSha256);
          prepared = await buildPreview(directory, state.dcat, input);
          need(prepared.result.complete && prepared.result.operations.length <= EXCHANGE_LIMITS.operations && prepared.previewSha256 === input.expectedPreviewSha256,
            'DCAT_EXCHANGE_PREVIEW_CHANGED', 'Resolve every conflict against the current author revision and review the complete preview.', 409);
          return { ...baseInput, operations: prepared.result.operations, expectedResultSha256: prepared.binding.documentSha256 };
        },
        async afterSave(revision) {
          if (prior) { await checkedFile(join(location(directory, 'decisions', id), 'decision.json'), prior.sha256, prior.bytes); await finish(id); return; }
          const journal = await pending('apply', input, requestSha256);
          prepared ??= await buildPreview(directory, state.dcat, input, false);
          need(prepared.result.complete && prepared.previewSha256 === input.expectedPreviewSha256 &&
            revision.documentSha256 === prepared.binding.documentSha256, 'DCAT_EXCHANGE_ADOPTION_CHANGED');
          const value = { schema: DECISION, id, requestSha256, request: copy(input), createdAt: journal.createdAt,
            correctionId: issue.correctionId, proposalId: proposal.id, revisionId: revision.id,
            previewSha256: prepared.previewSha256, binding: prepared.binding };
          const raw = bytes(value); need(raw.length <= 33554432, 'DCAT_EXCHANGE_DECISION_LIMIT');
          const path = location(directory, 'decisions', id); await privateDirectory(path, true); await retainExact(join(path, 'decision.json'), raw);
          const record = { id, requestId: id, requestSha256, createdAt: journal.createdAt, sha256: digest(raw), bytes: raw.length,
            correctionId: issue.correctionId, proposalId: proposal.id, exchangeId: issue.id, editionId: input.editionId,
            revisionId: revision.id, documentSha256: revision.documentSha256, previewSha256: prepared.previewSha256,
            author: input.author, note: input.note };
          current.decisions.push(record); await finish(id);
        }
      });
      return { ...result, proposalId: proposal.id, exchangeId: issue.id, correctionId: issue.correctionId, revisionId: id };
    },
    async dcatCorrectionExchangeDownload({ kind, id, key }) {
      let file, sha256, count, name, mediaType = 'application/json; charset=utf-8';
      if (kind === 'issue') {
        const read = await issueFile(directory, state.dcat, id); file = join(location(directory, 'issues', id), 'issue.json');
        sha256 = read.record.sha256; count = read.record.bytes; name = 'dcat-correction-issue-' + id + '.json';
      } else if (kind === 'recipient' || kind === 'initial-proposal') {
        const read = await issueFile(directory, state.dcat, id), html = kind === 'recipient';
        file = join(location(directory, 'issues', id), html ? 'recipient.html' : 'initial-proposal.json');
        sha256 = html ? read.record.recipientSha256 : read.record.initialProposalSha256;
        count = html ? read.record.recipientBytes : read.record.initialProposalBytes;
        name = 'dcat-correction-recipient-' + id + (html ? '.html' : '.json');
        if (html) mediaType = 'text/html; charset=utf-8';
      } else if (kind === 'file') {
        const read = await issueFile(directory, state.dcat, id), selected = read.value.files.find(x => x.key === key);
        need(selected, 'DCAT_EXCHANGE_FILE_NOT_FOUND', 'Select an original issued file.', 404);
        file = join(location(directory, 'issues', id), 'files', selected.sha256); sha256 = selected.sha256; count = selected.bytes; name = selected.name;
        await checkedFile(file, sha256, count, EXCHANGE_LIMITS.fileBytes);
      } else if (kind === 'proposal') {
        const read = await proposalFile(directory, state.dcat, id); file = join(location(directory, 'proposals', id), 'original.bin');
        sha256 = read.record.sha256; count = read.record.bytes; name = 'dcat-correction-proposal-' + id + '.' + read.record.format;
        if (read.record.format === 'html') mediaType = 'text/html; charset=utf-8';
      } else if (kind === 'decision') {
        const record = item(state.dcat, 'decisions', id); file = join(location(directory, 'decisions', id), 'decision.json');
        sha256 = record.sha256; count = record.bytes; name = 'dcat-correction-decision-' + id + '.json'; await checkedFile(file, sha256, count);
      } else throw fault('DCAT_EXCHANGE_DOWNLOAD_KIND');
      return { schema: 'stellar-forge.dcat-download.v1', kind: 'correction-exchange-' + kind, id, file,
        sha256, bytes: count, mediaType, hashHeader: 'x-dcat-sha256', downloadName: name };
    },
  };
}
