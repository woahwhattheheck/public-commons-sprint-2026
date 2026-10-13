// MIT. Retained, attributed catalogue corrections in the original locked workbench.
import { join } from 'node:path';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { object, bytes, digest, identity, readPrivate, privateDirectory, fault, stamp }
  from '../postgres/publisher/files.mjs';
import { parseCorrectionDocument, applyCorrectionOperations, inspectCorrectionDocument }
  from './public/dcat-correction-json.mjs';

const SCHEMA = 'stellar-forge.dcat-corrections.v1', REVISION = 'stellar-forge.dcat-correction-revision.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const MAX_DOCUMENT = 134217728, MAX_REVISION = 33554432;
const need = (condition, code, message, status = 400) => { if (!condition) throw fault(code, message, status); };
const text = (value, label, maximum = 512) => {
  need(typeof value === 'string' && value.trim() && value.length <= maximum, 'DCAT_CORRECTION_TEXT_REQUIRED', 'Enter ' + label + '.');
  return value.trim();
};
function requestId(value) { need(UUID.test(value ?? ''), 'DCAT_CORRECTION_REQUEST_ID', 'Supply one stable UUID for this operation.'); return value; }
function rawText(raw) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
  catch { throw fault('DCAT_CORRECTION_UTF8_REQUIRED', 'Choose a UTF-8 catalogue or a converted candidate from the original migration review. The original source remains retained.'); }
}
const revisionRoot = (directory, id, revisionId) => join(directory, 'dcat', 'corrections', id, 'revisions', revisionId);
const complete = value => structuredClone(value);
function selectedDraft(state, id) {
  need(UUID.test(id ?? ''), 'DCAT_CORRECTION_NOT_FOUND', 'Choose an existing correction draft.', 404);
  const row = state?.corrections?.drafts.find(item => item.id === id);
  need(row, 'DCAT_CORRECTION_NOT_FOUND', 'Choose an existing correction draft.', 404); return row;
}
function selectedRevision(draft, id = draft.headRevisionId) {
  need(UUID.test(id ?? ''), 'DCAT_CORRECTION_REVISION_NOT_FOUND', 'Choose an existing saved revision.', 404);
  const row = draft.revisions.find(item => item.id === id);
  need(row, 'DCAT_CORRECTION_REVISION_NOT_FOUND', 'Choose an existing saved revision.', 404); return row;
}
function sameGuard(draft, revision, input) {
  need(input.expectedRevisionId === draft.headRevisionId && revision.id === draft.headRevisionId &&
    input.expectedDocumentSha256 === revision.documentSha256, 'DCAT_CORRECTION_REVISION_CHANGED',
    'This draft has a newer saved revision. Inspect it before saving another change.', 409);
}
export function validateDcatCorrections(state) {
  if (state?.corrections === undefined) return;
  const current = state.corrections;
  need(object(current) && current.schema === SCHEMA && Array.isArray(current.drafts), 'DCAT_CORRECTION_STATE_INVALID');
  need(current.pending === undefined || Array.isArray(current.pending), 'DCAT_CORRECTION_PENDING_INVALID');
  const requests = new Set();
  for (const pending of current.pending ?? []) {
    need(object(pending) && UUID.test(pending.requestId ?? '') && !requests.has(pending.requestId) &&
      HASH.test(pending.requestSha256 ?? '') && UUID.test(pending.correctionId ?? '') &&
      UUID.test(pending.revisionId ?? '') && typeof pending.createdAt === 'string', 'DCAT_CORRECTION_PENDING_INVALID');
    requests.add(pending.requestId);
  }
  const drafts = new Set();
  for (const draft of current.drafts) {
    need(object(draft) && UUID.test(draft.id ?? '') && !drafts.has(draft.id) && HASH.test(draft.requestSha256 ?? '') &&
      object(draft.source) && ['catalog', 'candidate'].includes(draft.source.kind) &&
      UUID.test(draft.source.id ?? '') && HASH.test(draft.source.sha256 ?? '') &&
      Array.isArray(draft.revisions) && draft.revisions.length > 0 && Array.isArray(draft.materializations),
      'DCAT_CORRECTION_STATE_INVALID');
    drafts.add(draft.id);
    const source = (draft.source.kind === 'catalog' ? state.catalogs : state.reviews).find(row => row.id === draft.source.id);
    need(source && (draft.source.kind === 'catalog' ? source.sha256 : source.candidateSha256) === draft.source.sha256 &&
      (draft.source.kind === 'catalog' ? source.bytes : source.candidateBytes) === draft.source.bytes,
      'DCAT_CORRECTION_SOURCE_CHANGED');
    let prior = null; const seen = new Set();
    for (const revision of draft.revisions) {
      need(object(revision) && UUID.test(revision.id ?? '') && !seen.has(revision.id) &&
        HASH.test(revision.sha256 ?? '') && HASH.test(revision.documentSha256 ?? '') && HASH.test(revision.requestSha256 ?? '') &&
        Number.isSafeInteger(revision.bytes) && revision.bytes > 0 && revision.bytes <= MAX_REVISION &&
        Number.isSafeInteger(revision.documentBytes) && revision.documentBytes >= 2 && revision.documentBytes <= MAX_DOCUMENT &&
        revision.previousRevisionId === (prior?.id ?? null) &&
        revision.previousRevisionSha256 === (prior?.sha256 ?? null), 'DCAT_CORRECTION_REVISION_INVALID');
      seen.add(revision.id); prior = revision;
    }
    need(draft.headRevisionId === prior.id, 'DCAT_CORRECTION_HEAD_INVALID');
    const materialized = new Set();
    for (const row of draft.materializations) {
      const revision = selectedRevision(draft, row.revisionId), catalog = state.catalogs.find(item => item.id === row.catalogId);
      need(UUID.test(row.requestId ?? '') && !materialized.has(row.requestId) && HASH.test(row.requestSha256 ?? '') &&
        catalog && catalog.sha256 === revision.documentSha256 && catalog.bytes === revision.documentBytes &&
        catalog.correction?.correctionId === draft.id && catalog.correction?.revisionId === revision.id &&
        catalog.correction?.revisionSha256 === revision.sha256 && row.sha256 === catalog.sha256,
        'DCAT_CORRECTION_MATERIALIZATION_INVALID');
      materialized.add(row.requestId);
    }
  }
}
async function revisionFiles(directory, draft, revision) {
  const root = revisionRoot(directory, draft.id, revision.id);
  const [raw, document] = await Promise.all([
    readPrivate(join(root, 'revision.json'), MAX_REVISION), readPrivate(join(root, 'document.json'), MAX_DOCUMENT)
  ]);
  need(raw.length === revision.bytes && digest(raw) === revision.sha256 &&
    document.length === revision.documentBytes && digest(document) === revision.documentSha256,
    'DCAT_CORRECTION_RETAINED_FILE_CHANGED', 'The retained revision differs from its complete saved bytes.', 409);
  let record; try { record = JSON.parse(rawText(raw)); } catch { throw fault('DCAT_CORRECTION_REVISION_INVALID'); }
  need(record.schema === REVISION && record.correctionId === draft.id && record.id === revision.id &&
    record.requestSha256 === revision.requestSha256 &&
    record.previousRevisionId === revision.previousRevisionId && record.previousRevisionSha256 === revision.previousRevisionSha256 &&
    record.documentSha256 === revision.documentSha256 && record.documentBytes === revision.documentBytes &&
    identity(record.source) === identity(draft.source) && record.author === revision.author && record.note === revision.note &&
    record.createdAt === revision.createdAt && record.kind === revision.kind &&
    Array.isArray(record.operations) && record.operations.length === revision.operationCount && Array.isArray(record.changes),
    'DCAT_CORRECTION_REVISION_BINDING_CHANGED');
  return { record, raw, document, text: rawText(document) };
}
export async function validateDcatCorrectionFiles(directory, state) {
  validateDcatCorrections(state);
  for (const draft of state?.corrections?.drafts ?? []) {
    let previous = null; const verified = new Map();
    for (const revision of draft.revisions) {
      const value = await revisionFiles(directory, draft, revision);
      if (!previous) need(value.document.length === draft.source.bytes && digest(value.document) === draft.source.sha256 &&
        value.record.kind === 'source' && Array.isArray(value.record.operations) && value.record.operations.length === 0,
        'DCAT_CORRECTION_BASE_CHANGED');
      else if (value.record.kind === 'restore') {
        const target = verified.get(value.record.targetRevisionId);
        need(target && value.record.operations.length === 0 &&
          target.documentSha256 === revision.documentSha256 && target.documentBytes === revision.documentBytes,
          'DCAT_CORRECTION_RESTORE_HISTORY_CHANGED');
        const expected = [{ op: 'restore', beforeRevisionId: previous.record.id, targetRevisionId: target.id,
          beforeDocumentSha256: previous.record.documentSha256, beforeDocumentBytes: previous.record.documentBytes,
          afterDocumentSha256: target.documentSha256, afterDocumentBytes: target.documentBytes }];
        need(identity(expected) === identity(value.record.changes), 'DCAT_CORRECTION_RESTORE_HISTORY_CHANGED');
      } else {
        need(value.record.kind === 'edit', 'DCAT_CORRECTION_REVISION_KIND');
        const applied = applyCorrectionOperations(previous.text, value.record.operations);
        need(Buffer.from(applied.text, 'utf8').equals(value.document) &&
          identity(applied.changes) === identity(value.record.changes), 'DCAT_CORRECTION_CHANGE_HISTORY_CHANGED');
      }
      verified.set(revision.id, revision); previous = value;
    }
  }
}
export function dcatCorrectionsSummary(state) {
  return (state?.corrections?.drafts ?? []).map(draft => ({
    id: draft.id, source: complete(draft.source), headRevisionId: draft.headRevisionId,
    revisions: draft.revisions.map(({ id, sha256, documentSha256, documentBytes }) => ({ id, sha256, documentSha256, documentBytes })),
    materializations: complete(draft.materializations)
  }));
}
export function createDcatCorrections({ directory, state, dcat, launch, persist }) {
  if (state.dcat.corrections === undefined) state.dcat.corrections = { schema: SCHEMA, drafts: [] };
  validateDcatCorrections(state.dcat);
  const current = state.dcat.corrections, draft = value => selectedDraft(state.dcat, value);
  current.pending ??= [];
  async function pending(input, requestSha256, correctionId, revisionId) {
    let entry = current.pending.find(row => row.requestId === input.requestId);
    if (entry) need(entry.requestSha256 === requestSha256 && entry.correctionId === correctionId &&
      entry.revisionId === revisionId, 'DCAT_CORRECTION_REQUEST_CHANGED', 'Resume the original request with its unchanged payload.', 409);
    else {
      entry = { requestId: input.requestId, requestSha256, correctionId, revisionId, createdAt: stamp() };
      current.pending.push(entry); await persist();
    }
    return entry;
  }
  function finishRequest(id) { current.pending = current.pending.filter(row => row.requestId !== id); }
  async function retainExact(path, content) {
    const handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = await handle.stat();
      need(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) && stat.size <= content.length,
        'DCAT_CORRECTION_PARTIAL_FILE_CHANGED');
      const prior = Buffer.alloc(stat.size); let read = 0;
      while (read < prior.length) {
        const part = await handle.read(prior, read, prior.length - read, read);
        need(part.bytesRead > 0, 'DCAT_CORRECTION_PARTIAL_FILE_CHANGED'); read += part.bytesRead;
      }
      need(prior.equals(content.subarray(0, prior.length)), 'DCAT_CORRECTION_PARTIAL_FILE_CHANGED',
        'The retained partial file differs from this exact request.', 409);
      let offset = prior.length;
      while (offset < content.length) {
        const part = await handle.write(content, offset, content.length - offset, offset);
        need(part.bytesWritten > 0, 'DCAT_CORRECTION_WRITE_FAILED'); offset += part.bytesWritten;
      }
      await handle.sync();
    } finally { await handle.close(); }
  }
  async function retainRevision(selected, id, requestSha256, document, info) {
    need(document.length >= 2 && document.length <= MAX_DOCUMENT, 'DCAT_CORRECTION_DOCUMENT_SIZE', 'The complete catalogue exceeds 128 MiB.');
    const parsed = parseCorrectionDocument(rawText(document));
    need(parsed.root.type === 'object', 'DCAT_CORRECTION_CATALOG_OBJECT', 'A catalogue must be a JSON object.');
    const prior = selected.revisions.at(-1) ?? null;
    const record = { schema: REVISION, correctionId: selected.id, id, requestSha256,
      previousRevisionId: prior?.id ?? null, previousRevisionSha256: prior?.sha256 ?? null,
      source: complete(selected.source), documentSha256: digest(document), documentBytes: document.length,
      ...info };
    const raw = bytes(record);
    need(raw.length <= MAX_REVISION, 'DCAT_CORRECTION_REVISION_SIZE', 'The complete attributed change record exceeds 32 MiB.');
    const root = revisionRoot(directory, selected.id, id); await privateDirectory(root, true);
    await retainExact(join(root, 'document.json'), document);
    await retainExact(join(root, 'revision.json'), raw);
    const revision = { id, requestSha256, sha256: digest(raw), bytes: raw.length,
      previousRevisionId: record.previousRevisionId, previousRevisionSha256: record.previousRevisionSha256,
      documentSha256: record.documentSha256, documentBytes: record.documentBytes,
      createdAt: record.createdAt, kind: record.kind, author: record.author, note: record.note,
      operationCount: record.operations.length };
    selected.revisions.push(revision); selected.headRevisionId = id; selected.updatedAt = record.createdAt;
    return revision;
  }
  function attribution(input) { return { author: text(input.author, 'the editor name', 160), note: text(input.note, 'the reason for this revision', 8192) }; }
  function mutationShape(input, kind) {
    need(object(input), 'DCAT_CORRECTION_INPUT_INVALID');
    requestId(input.requestId);
    return identity({ kind, input });
  }
  function replay(selected, id, requestSha256) {
    const prior = selected.revisions.find(row => row.id === id);
    if (prior) need(prior.requestSha256 === requestSha256, 'DCAT_CORRECTION_REQUEST_CHANGED',
      'This request UUID already belongs to a different saved operation.', 409);
    return prior;
  }
  async function preview(input) {
    const selected = draft(input.correctionId), revision = selectedRevision(selected, input.expectedRevisionId);
    sameGuard(selected, revision, input);
    const value = await revisionFiles(directory, selected, revision);
    const result = applyCorrectionOperations(value.text, input.operations), raw = Buffer.from(result.text, 'utf8');
    need(raw.length >= 2 && raw.length <= MAX_DOCUMENT, 'DCAT_CORRECTION_DOCUMENT_SIZE');
    return { selected, revision, value, result, raw };
  }
  return {
    listDcatCorrections({ offset = 0, limit = 50, query = '' } = {}) {
      need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 200 &&
        typeof query === 'string' && query.length <= 2000, 'DCAT_CORRECTION_PAGE_INVALID');
      const needle = query.toLocaleLowerCase(), rows = current.drafts.filter(row =>
        !needle || (row.label + ' ' + row.author + ' ' + row.source.id).toLocaleLowerCase().includes(needle));
      return { offset, limit, total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null,
        rows: rows.slice(offset, offset + limit).map(row => ({ ...complete(row), revisions: undefined,
          revisionCount: row.revisions.length, head: complete(selectedRevision(row)) })) };
    },
    async dcatCorrection(id) {
      const selected = draft(id); await revisionFiles(directory, selected, selectedRevision(selected)); return complete(selected);
    },
    async inspectDcatCorrection(input) {
      const selected = draft(input.correctionId), revision = selectedRevision(selected, input.revisionId);
      const value = await revisionFiles(directory, selected, revision);
      return { correctionId: selected.id, label: selected.label, source: complete(selected.source), headRevisionId: selected.headRevisionId,
        revision: complete(revision), selection: inspectCorrectionDocument(value.text, input) };
    },
    async dcatCorrectionDownload(input) {
      const selected = draft(input.correctionId), revision = selectedRevision(selected, input.revisionId);
      await revisionFiles(directory, selected, revision);
      const kind = input.kind ?? 'document'; need(['document', 'revision'].includes(kind), 'DCAT_CORRECTION_DOWNLOAD_KIND');
      const document = kind === 'document';
      return { schema: 'stellar-forge.dcat-download.v1', kind: 'correction-' + kind,
        id: revision.id, correctionId: selected.id, file: join(revisionRoot(directory, selected.id, revision.id), kind + '.json'),
        sha256: document ? revision.documentSha256 : revision.sha256,
        bytes: document ? revision.documentBytes : revision.bytes,
        mediaType: 'application/json; charset=utf-8', hashHeader: 'x-dcat-sha256',
        downloadName: 'dcat-correction-' + selected.id + '-' + revision.id + '-' + kind + '.json' };
    },
    async previewDcatCorrection(input) {
      const value = await preview(input);
      return { correctionId: value.selected.id, revisionId: value.revision.id, sourceDocumentSha256: value.revision.documentSha256,
        documentSha256: digest(value.raw), documentBytes: value.raw.length, changes: value.result.changes };
    },
    createDcatCorrection(input) {
      const requestSha256 = mutationShape(input, 'create'), id = input.requestId, credit = attribution(input);
      need(['catalog', 'candidate'].includes(input.kind), 'DCAT_CORRECTION_SOURCE_KIND');
      const label = text(input.label, 'a correction draft label');
      need(HASH.test(input.expectedSha256 ?? ''), 'DCAT_CORRECTION_SOURCE_HASH');
      const prior = current.drafts.find(row => row.id === id);
      if (prior) {
        need(prior.requestSha256 === requestSha256, 'DCAT_CORRECTION_REQUEST_CHANGED', 'This request UUID already belongs to a different draft.', 409);
        return { ...launch('reopen saved catalogue correction', async () => complete(prior)), correctionId: id, revisionId: prior.revisions[0].id };
      }
      const id0 = current.pending.find(row => row.requestId === id)?.revisionId ?? randomUUID();
      return { ...launch('create catalogue correction draft', async () => {
        const descriptor = input.kind === 'catalog' ? await dcat.dcatCatalogDownload(input.catalogId) :
          await dcat.dcatReviewDownload(input.reviewId, 'candidate');
        need(descriptor.sha256 === input.expectedSha256, 'DCAT_CORRECTION_SOURCE_CHANGED', 'Inspect this exact original or candidate before creating its correction draft.', 409);
        const raw = await readPrivate(descriptor.file, MAX_DOCUMENT);
        need(raw.length === descriptor.bytes && digest(raw) === descriptor.sha256, 'DCAT_CORRECTION_SOURCE_CHANGED');
        const original = input.kind === 'catalog' ? state.dcat.catalogs.find(row => row.id === input.catalogId) :
          state.dcat.reviews.find(row => row.id === input.reviewId);
        const base = state.dcat.catalogs.find(row => row.id === (input.kind === 'catalog' ? original.id : original.sourceId));
        const journal = await pending(input, requestSha256, id, id0);
        const selected = { id, requestSha256, label, author: credit.author, createdAt: journal.createdAt, updatedAt: journal.createdAt,
          source: { kind: input.kind, id: original.id, sha256: descriptor.sha256, bytes: descriptor.bytes,
            profile: input.kind === 'candidate' ? '3.0' : original.profile, migrationSourceId: base.id, origin: base.origin ?? null },
          revisions: [], materializations: [], headRevisionId: null };
        await retainRevision(selected, id0, requestSha256, raw, { kind: 'source', createdAt: journal.createdAt, ...credit, operations: [], changes: [] });
        current.drafts.push(selected); finishRequest(id); await persist(); return complete(selected);
      }), correctionId: id, revisionId: id0 };
    },
    saveDcatCorrection(input) {
      const requestSha256 = mutationShape(input, 'edit'), selected = draft(input.correctionId), id = input.requestId, credit = attribution(input);
      const prior = replay(selected, id, requestSha256);
      return { ...launch(prior ? 'reopen saved catalogue correction revision' : 'save catalogue correction revision', async () => {
        if (prior) { await revisionFiles(directory, selected, prior); return { correctionId: selected.id, revision: complete(prior) }; }
        const value = await preview(input);
        need(input.expectedResultSha256 === undefined || input.expectedResultSha256 === digest(value.raw),
          'DCAT_CORRECTION_PREVIEW_CHANGED', 'Preview the complete current change set before saving.', 409);
        const journal = await pending(input, requestSha256, selected.id, id);
        const revision = await retainRevision(selected, id, requestSha256, value.raw,
          { kind: 'edit', createdAt: journal.createdAt, ...credit, operations: complete(input.operations), changes: value.result.changes });
        finishRequest(id); await persist(); return { correctionId: selected.id, revision: complete(revision) };
      }), correctionId: selected.id, revisionId: id };
    },
    restoreDcatCorrection(input) {
      const requestSha256 = mutationShape(input, 'restore'), selected = draft(input.correctionId), id = input.requestId, credit = attribution(input);
      const prior = replay(selected, id, requestSha256);
      return { ...launch(prior ? 'reopen saved catalogue restoration' : 'restore earlier catalogue revision', async () => {
        if (prior) { await revisionFiles(directory, selected, prior); return { correctionId: selected.id, revision: complete(prior) }; }
        const head = selectedRevision(selected, input.expectedRevisionId); sameGuard(selected, head, input);
        const target = selectedRevision(selected, input.targetRevisionId);
        await revisionFiles(directory, selected, head);
        const targetValue = await revisionFiles(directory, selected, target);
        const changes = [{ op: 'restore', beforeRevisionId: head.id, targetRevisionId: target.id,
          beforeDocumentSha256: head.documentSha256, beforeDocumentBytes: head.documentBytes,
          afterDocumentSha256: target.documentSha256, afterDocumentBytes: target.documentBytes }];
        const journal = await pending(input, requestSha256, selected.id, id);
        const revision = await retainRevision(selected, id, requestSha256, targetValue.document,
          { kind: 'restore', createdAt: journal.createdAt, targetRevisionId: target.id, ...credit, operations: [], changes });
        finishRequest(id); await persist(); return { correctionId: selected.id, revision: complete(revision) };
      }), correctionId: selected.id, revisionId: id };
    },
    materializeDcatCorrection(input) {
      const requestSha256 = mutationShape(input, 'materialize'), selected = draft(input.correctionId),
        revision = selectedRevision(selected, input.revisionId), id = input.requestId, credit = attribution(input);
      need(input.expectedDocumentSha256 === revision.documentSha256, 'DCAT_CORRECTION_REVISION_CHANGED');
      need(['auto', '1.1', '3.0'].includes(input.profile), 'DCAT_CORRECTION_PROFILE_INVALID');
      const label = text(input.label, 'the retained candidate label');
      const prior = selected.materializations.find(row => row.requestId === id);
      if (prior) need(prior.requestSha256 === requestSha256, 'DCAT_CORRECTION_REQUEST_CHANGED', 'This request UUID belongs to a different materialization.', 409);
      return { ...launch(prior ? 'reopen retained corrected catalogue' : 'retain corrected catalogue candidate', async () => {
        if (prior) return complete(prior);
        need(!state.dcat.catalogs.some(row => row.id === id), 'DCAT_CORRECTION_CATALOG_EXISTS');
        const value = await revisionFiles(directory, selected, revision);
        const journal = await pending(input, requestSha256, selected.id, revision.id), createdAt = journal.createdAt;
        const catalog = { id, label, profile: input.profile, origin: selected.source.origin,
          receivedAt: createdAt, sha256: revision.documentSha256, bytes: revision.documentBytes,
          correction: { correctionId: selected.id, revisionId: revision.id, revisionSha256: revision.sha256, ...credit } };
        const root = join(directory, 'dcat', 'catalogs', id); await privateDirectory(root, true);
        await retainExact(join(root, 'catalog.json'), value.document);
        const result = { requestId: id, requestSha256, correctionId: selected.id, revisionId: revision.id,
          catalogId: id, sha256: catalog.sha256, bytes: catalog.bytes, profile: catalog.profile,
          migrationSourceId: selected.source.migrationSourceId, createdAt, ...credit };
        state.dcat.catalogs.push(catalog); selected.materializations.push(result); finishRequest(id); await persist(); return complete(result);
      }), correctionId: selected.id, revisionId: revision.id, catalogId: id };
    },
  };
}
