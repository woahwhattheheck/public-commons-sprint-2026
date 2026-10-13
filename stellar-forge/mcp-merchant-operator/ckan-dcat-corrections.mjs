// MIT. Complete catalogue corrections through the original model, lease and file reader.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { failure, plain } from './config.mjs';

const PREFIX = 'merchant_ckan_dcat_correction_';
export const CORRECTION_INPUT_MAX_BYTES = 33554432;
const PAGE_BYTES = 65536, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const need = (condition, message) => { if (!condition) throw failure('INVALID_PARAMS', message); };
const id = value => { need(typeof value === 'string' && UUID.test(value), 'Select an original UUID.'); return value; };
const hash = value => { need(typeof value === 'string' && HASH.test(value), 'Bind the complete inspected SHA-256.'); return value; };
const integer = (value, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  value = value === undefined ? fallback : value; need(Number.isSafeInteger(value) && value >= 0 && value <= maximum, 'Choose a supported page position.');
  return value;
};
function page(input) {
  const limit = integer(input.limit, 25, 100); need(limit > 0, 'Use a limit from 1 to 100.');
  return { offset: integer(input.offset, 0), limit };
}
function query(input) {
  need(input.query === undefined || typeof input.query === 'string' && input.query.length <= 2000, 'Use a bounded text filter.');
  return input.query ?? '';
}
function guard(input) {
  return { correctionId: id(input.correctionId), expectedRevisionId: id(input.expectedRevisionId),
    expectedDocumentSha256: hash(input.expectedDocumentSha256) };
}
function credit(input) {
  need(typeof input.author === 'string' && input.author.trim() && input.author.length <= 160, 'Retain the editor name.');
  need(typeof input.note === 'string' && input.note.trim() && input.note.length <= 8192, 'Retain the revision reason.');
  return { requestId: id(input.requestId), author: input.author, note: input.note };
}
async function edits(context, input) {
  need((input.operations === undefined) !== (input.operationsInput === undefined),
    'Select inline operations or one exact host-declared operations input.');
  need((input.operationsInput === undefined) === (input.expectedOperationsSha256 === undefined),
    'Bind the selected original operations file to its full SHA-256.');
  let value = input.operations;
  if (input.operationsInput !== undefined) {
    const selected = context.input(input.operationsInput);
    need(selected.kind === 'dcat-corrections', 'Use a host-declared dcat-corrections input.');
    const original = await context.privateFile(selected.file, CORRECTION_INPUT_MAX_BYTES, true);
    if (original.sha256 !== hash(input.expectedOperationsSha256)) throw failure('CKAN_INPUT_CHANGED', 'The original operations file changed.');
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original.content)); }
    catch { throw failure('INVALID_PARAMS', 'Use a complete UTF-8 JSON array of ordered edits.'); }
  }
  need(Array.isArray(value) && value.length > 0 && value.length <= 1000, 'Supply one to 1,000 ordered edits.');
  for (const row of value) {
    need(plain(row) && ['add', 'replace', 'remove', 'move'].includes(row.op), 'Choose an original supported edit.');
    const allowed = ['op', 'path', ...(row.op === 'move' ? ['from'] : ['add', 'replace'].includes(row.op) ? ['valueText'] : [])];
    need(Object.keys(row).every(key => allowed.includes(key)), 'Use only the selected edit fields.');
    for (const key of row.op === 'move' ? ['path', 'from'] : ['path'])
      need(typeof row[key] === 'string' && row[key].length <= 16384, 'Use the literal JSON pointer.');
    if (['add', 'replace'].includes(row.op)) need(typeof row.valueText === 'string', 'Keep the replacement as exact JSON literal text.');
  }
  need(Buffer.byteLength(JSON.stringify(value)) <= CORRECTION_INPUT_MAX_BYTES, 'The complete operations array exceeds 32 MiB.');
  return value;
}
function rawFile(value, name) {
  const raw = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  return { raw, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'), name, type: 'application/json' };
}
function syntheticFile(file, method, selection) {
  return { name: file.name, mediaType: file.type, bytes: file.bytes, sha256: file.sha256,
    read: { tool: PREFIX + method, ...selection, expectedSha256: file.sha256 } };
}
function displayRows(rows, offset, total, nextOffset, completeFile, publicData) {
  const shown = []; let bytes = 0;
  for (const [index, original] of rows.entries()) {
    const value = publicData(original), count = Buffer.byteLength(JSON.stringify(value));
    const item = count > PAGE_BYTES ? { oversized: true, originalOffset: offset + index,
      displayBytes: count, completeFile } : value;
    const size = Buffer.byteLength(JSON.stringify(item));
    if (shown.length && bytes + size > PAGE_BYTES) break;
    shown.push(item); bytes += size;
  }
  return { rows: shown, offset, total, nextOffset: shown.length < rows.length ? offset + shown.length : nextOffset,
    displayBytes: bytes };
}
function selected(input, requiredRevision = false) {
  const value = { correctionId: id(input.correctionId), kind: input.kind ?? 'document' };
  need(['document', 'revision'].includes(value.kind), 'Choose the complete document or revision record.');
  if (requiredRevision || input.revisionId !== undefined) value.revisionId = id(input.revisionId);
  return value;
}
async function descriptor(context, selection) {
  const file = await context.model.dcatCorrectionDownload(selection);
  need(plain(file) && file.correctionId === selection.correctionId && UUID.test(file.id ?? '') &&
    typeof file.file === 'string' && HASH.test(file.sha256 ?? '') && Number.isSafeInteger(file.bytes) &&
    file.bytes >= 0 && file.bytes <= 134217728, 'The original correction descriptor changed.');
  if (selection.revisionId) need(file.id === selection.revisionId, 'The selected revision changed.');
  return file;
}
function publicFile(file, kind) {
  return { correctionId: file.correctionId, revisionId: file.id, kind, name: file.downloadName,
    mediaType: file.mediaType, bytes: file.bytes, sha256: file.sha256,
    read: { correctionId: file.correctionId, revisionId: file.id, kind, expectedSha256: file.sha256 } };
}
async function openOriginal(context, selection) {
  const file = await descriptor(context, selection), handle = await open(file.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n || info.mode & 0o077n || info.size !== BigInt(file.bytes))
      throw failure('CKAN_CORRECTION_FILE_CHANGED', 'The original private correction file changed.');
    return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256, name: file.downloadName, type: file.mediaType };
  } catch (error) { await handle.close(); throw error; }
}
export function pageDcatCorrectionState(value, limit = 25) {
  if (value === undefined) return undefined;
  need(plain(value) && value.schema === 'stellar-forge.dcat-corrections.v1' && Array.isArray(value.drafts),
    'Open the original correction workspace.');
  return { schema: value.schema, total: value.drafts.length, pendingCount: (value.pending ?? []).length,
    drafts: value.drafts.slice(0, limit).map(row => ({ id: row.id, label: row.label, source: { kind: row.source.kind, id: row.source.id, sha256: row.source.sha256 },
      headRevisionId: row.headRevisionId, revisionCount: row.revisions.length, materializationCount: row.materializations.length })),
    inspectTool: PREFIX + 'list' };
}
async function preview(context, input) {
  const value = { ...guard(input), operations: await edits(context, input) };
  return context.model.previewDcatCorrection(value);
}
export async function executeCkanDcatCorrection(context, name, input) {
  const { model, workspace } = context;
  if (name === PREFIX + 'list') {
    const requested = page(input), value = await model.listDcatCorrections({ ...requested, query: query(input) });
    // List summaries omit large attribution/history; get and metadata_read retain the full record.
    const rows = value.rows.map(row => ({ id: row.id, label: row.label,
      source: { kind: row.source.kind, id: row.source.id, sha256: row.source.sha256 },
      createdAt: row.createdAt, updatedAt: row.updatedAt, headRevisionId: row.headRevisionId,
      revisionCount: row.revisionCount, materializationCount: row.materializations?.length ?? 0,
      head: row.head ? { id: row.head.id, documentSha256: row.head.documentSha256, documentBytes: row.head.documentBytes } : null }));
    const pending = context.native().dcat?.corrections?.pending ?? [], pendingOffset = integer(input.pendingOffset, 0);
    return { workspace, ...context.publicData({ ...value, rows }),
      pending: { rows: context.publicData(pending.slice(pendingOffset, pendingOffset + requested.limit)),
        offset: pendingOffset, limit: requested.limit, total: pending.length,
        nextOffset: pendingOffset + requested.limit < pending.length ? pendingOffset + requested.limit : null } };
  }
  if (name === PREFIX + 'get' || name === PREFIX + 'metadata_read') {
    const correctionId = id(input.correctionId);
    if (name.endsWith('metadata_read')) {
      const chunk = await context.reads.read({ scope: context.scope, key: 'dcat-correction-metadata:' + correctionId,
        kind: 'ckan-dcat-correction-metadata', directory: context.directory, expectedSha256: hash(input.expectedSha256),
        readId: input.readId, offset: input.offset, limit: input.limit,
        load: async () => { const file = rawFile(await model.dcatCorrection(correctionId), 'dcat-correction-' + correctionId + '-history.json');
          return { name: file.name, type: file.type, bytes: file.raw }; } });
      return { workspace, correctionId, ...chunk };
    }
    const value = await model.dcatCorrection(correctionId), file = rawFile(value, 'dcat-correction-' + correctionId + '-history.json');
    const completeFile = syntheticFile(file, 'metadata_read', { correctionId });
    const { revisions, materializations, ...metadata } = value, limit = page(input).limit;
    const ro = integer(input.revisionsOffset, 0), mo = integer(input.materializationsOffset, 0);
    return { workspace, correction: context.publicData(metadata), completeFile,
      revisions: { limit, ...displayRows(revisions.slice(ro, ro + limit), ro, revisions.length,
        ro + limit < revisions.length ? ro + limit : null, completeFile, context.publicData) },
      materializations: { limit, ...displayRows(materializations.slice(mo, mo + limit), mo, materializations.length,
        mo + limit < materializations.length ? mo + limit : null, completeFile, context.publicData) } };
  }
  if (name === PREFIX + 'inspect') {
    const correctionId = id(input.correctionId), selection = { correctionId, pointer: input.pointer ?? '',
      ...page(input), query: query(input), ...(input.revisionId ? { revisionId: id(input.revisionId) } : {}) };
    need(typeof selection.pointer === 'string' && selection.pointer.length <= 16384, 'Use the original JSON pointer.');
    const value = await model.inspectDcatCorrection(selection), original = await descriptor(context, {
      correctionId, revisionId: value.revision.id, kind: 'document' });
    const full = publicFile(original, 'document'), node = value.selection;
    if (typeof node.literalText === 'string' && Buffer.byteLength(node.literalText) > PAGE_BYTES / 2)
      Object.assign(node, { literalText: null, literalComplete: false, displayLimited: true });
    const { rows, ...metadata } = node;
    return { workspace, ...context.publicData({ ...value, selection: undefined }),
      selection: { ...context.publicData(metadata), ...displayRows(rows, node.offset, node.total,
        node.nextOffset, full, context.publicData) }, completeFile: full };
  }
  if (name === PREFIX + 'preview' || name === PREFIX + 'preview_read') {
    if (name.endsWith('preview_read')) {
      const selection = guard(input);
      const chunk = await context.reads.read({ scope: context.scope,
        key: 'dcat-correction-preview:' + selection.correctionId + ':' + selection.expectedRevisionId + ':' + hash(input.expectedSha256),
        kind: 'ckan-dcat-correction-preview', directory: context.directory, expectedSha256: input.expectedSha256,
        readId: input.readId, offset: input.offset, limit: input.limit,
        load: async () => { const file = rawFile(await preview(context, input), 'dcat-correction-preview.json');
          return { name: file.name, type: file.type, bytes: file.raw }; } });
      return { workspace, correctionId: selection.correctionId, ...chunk };
    }
    const value = await preview(context, input), file = rawFile(value, 'dcat-correction-preview.json');
    const completeFile = syntheticFile(file, 'preview_read', { ...guard(input),
      ...(input.operationsInput === undefined ? {} : { operationsInput: input.operationsInput,
        expectedOperationsSha256: input.expectedOperationsSha256 }) });
    const { changes, ...metadata } = value, requested = page(input);
    return { workspace, ...context.publicData(metadata), completeFile,
      operationsSelection: input.operationsInput === undefined ? 'Reuse the same complete inline operations for preview_read.' : 'Retained host alias and exact hash.',
      changes: { limit: requested.limit, ...displayRows(changes.slice(requested.offset, requested.offset + requested.limit),
        requested.offset, changes.length, requested.offset + requested.limit < changes.length ? requested.offset + requested.limit : null,
        completeFile, context.publicData) } };
  }
  if (name === PREFIX + 'create') {
    need(['catalog', 'candidate'].includes(input.kind), 'Choose an original catalogue or reviewed candidate.');
    need(input.kind === 'catalog' ? input.catalogId !== undefined && input.reviewId === undefined :
      input.reviewId !== undefined && input.catalogId === undefined, 'Select exactly the catalogue or candidate review UUID.');
    need(typeof input.label === 'string' && input.label.trim() && input.label.length <= 512, 'Name the correction draft.');
    const value = { ...credit(input), kind: input.kind, expectedSha256: hash(input.expectedSha256), label: input.label,
      ...(input.kind === 'catalog' ? { catalogId: id(input.catalogId) } : { reviewId: id(input.reviewId) }) };
    return context.launch(() => model.createDcatCorrection(value));
  }
  if (name === PREFIX + 'save') {
    const value = { ...guard(input), ...credit(input), operations: await edits(context, input),
      ...(input.expectedResultSha256 !== undefined ? { expectedResultSha256: hash(input.expectedResultSha256) } : {}) };
    return context.launch(() => model.saveDcatCorrection(value));
  }
  if (name === PREFIX + 'restore') {
    const value = { ...guard(input), ...credit(input), targetRevisionId: id(input.targetRevisionId) };
    return context.launch(() => model.restoreDcatCorrection(value));
  }
  if (name === PREFIX + 'materialize') {
    need(['auto', '1.1', '3.0'].includes(input.profile), 'Choose the actual candidate profile.');
    need(typeof input.label === 'string' && input.label.trim() && input.label.length <= 512, 'Name the retained candidate.');
    const value = { ...credit(input), correctionId: id(input.correctionId), revisionId: id(input.revisionId),
      expectedDocumentSha256: hash(input.expectedDocumentSha256), profile: input.profile, label: input.label };
    return context.launch(() => model.materializeDcatCorrection(value));
  }
  if (name === PREFIX + 'files') {
    const selection = selected(input), file = await descriptor(context, selection);
    return { workspace, file: publicFile(file, selection.kind) };
  }
  if (name === PREFIX + 'file_read') {
    const selection = selected(input, true);
    const chunk = await context.reads.read({ scope: context.scope,
      key: 'dcat-correction:' + selection.correctionId + ':' + selection.revisionId + ':' + selection.kind,
      kind: 'ckan-dcat-correction-' + selection.kind, directory: context.directory,
      expectedSha256: hash(input.expectedSha256), readId: input.readId, offset: input.offset, limit: input.limit,
      load: () => openOriginal(context, selection) });
    return { workspace, ...selection, ...chunk };
  }
  throw failure('TOOL_NOT_FOUND', 'Unknown catalogue correction operation.');
}
