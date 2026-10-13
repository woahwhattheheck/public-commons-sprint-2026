// MIT. Recipient catalogue exchanges through the original owner, retained inputs and complete file reader.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { failure, plain } from './config.mjs';
export const CORRECTION_PROPOSAL_MAX_BYTES = 268435456;
export const CORRECTION_CHOICES_MAX_BYTES = 33554432;
const PREFIX = 'merchant_ckan_dcat_correction_exchange_';
const PAGE_BYTES = 65536, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const need = (ok, message) => { if (!ok) throw failure('INVALID_PARAMS', message); };
const id = x => { need(typeof x === 'string' && UUID.test(x), 'Select the original UUID.'); return x; };
const hash = x => { need(typeof x === 'string' && HASH.test(x), 'Bind the complete inspected SHA256.'); return x; };
const number = (x, fallback, max = Number.MAX_SAFE_INTEGER) => {
  x ??= fallback; need(Number.isSafeInteger(x) && x >= 0 && x <= max, 'Use a supported page position.'); return x;
};
const page = input => {
  const limit = number(input.limit, 25, 100); need(limit > 0, 'Use a page size from 1 to 100.');
  return { offset: number(input.offset, 0), limit };
};
const text = (x, max, label, empty = false) => {
  need(typeof x === 'string' && (empty || x.trim()) && x.length <= max, 'Supply ' + label + '.'); return x;
};
function rawFile(value, name) {
  const raw = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  return { raw, name, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'), mediaType: 'application/json' };
}
function completeFile(file, tool, selection) {
  return { name: file.name, mediaType: file.mediaType, bytes: file.bytes, sha256: file.sha256,
    read: { tool: PREFIX + tool, ...selection, expectedSha256: file.sha256 } };
}
function rowsPage(rows, originalPage, full, publicData) {
  const shown = []; let bytes = 0;
  for (const [index, row] of rows.entries()) {
    const value = publicData(row), size = Buffer.byteLength(JSON.stringify(value));
    const display = size > PAGE_BYTES ? { oversized: true, originalOffset: originalPage.offset + index,
      originalBytes: size, completeFile: typeof full === 'function' ? full(row) : full } : value;
    const count = Buffer.byteLength(JSON.stringify(display));
    if (shown.length && bytes + count > PAGE_BYTES) break;
    shown.push(display); bytes += count;
  }
  return { rows: shown, page: { ...originalPage,
    nextOffset: shown.length < rows.length ? originalPage.offset + shown.length : originalPage.nextOffset },
    displayBytes: bytes };
}
async function selectedChoices(context, input) {
  need(!(input.choices !== undefined && input.choicesInput !== undefined), 'Choose inline choices or one original host input alias.');
  need((input.choicesInput === undefined) === (input.expectedChoicesSha256 === undefined), 'Bind the original choices alias and SHA256 together.');
  let value = input.choices ?? [];
  if (input.choicesInput !== undefined) {
    const selected = context.input(input.choicesInput);
    need(selected.kind === 'dcat-correction-choices', 'Use a host input of kind dcat-correction-choices.');
    const checked = await context.privateFile(selected.file, CORRECTION_CHOICES_MAX_BYTES, true);
    need(checked.sha256 === hash(input.expectedChoicesSha256), 'The original choices file changed.');
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(checked.content)); }
    catch { throw failure('INVALID_PARAMS', 'Use a complete JSON array of exact path choices.'); }
  }
  need(Array.isArray(value) && value.length <= 10000, 'Select at most 10,000 explicit path choices.');
  const seen = new Set();
  for (const row of value) {
    need(plain(row) && Object.keys(row).every(key => ['path', 'choice'].includes(key)) &&
      typeof row.path === 'string' && row.path.length <= 16384 && !seen.has(row.path) &&
      ['current', 'returned', 'issued'].includes(row.choice), 'Use unique original paths and current, returned or issued choices.');
    seen.add(row.path);
  }
  need(Buffer.byteLength(JSON.stringify(value)) <= CORRECTION_CHOICES_MAX_BYTES, 'The complete choices exceed 32 MiB.');
  return value;
}
async function selection(context, input) {
  return { proposalId: id(input.proposalId), editionId: id(input.editionId),
    expectedRevisionId: id(input.expectedRevisionId), expectedDocumentSha256: hash(input.expectedDocumentSha256),
    choices: await selectedChoices(context, input) };
}
function metadataSelection(input) {
  need(['issue', 'proposal', 'pending'].includes(input.kind), 'Choose an issued package, received proposal or original pending request.');
  return { kind: input.kind, id: id(input.id) };
}
async function metadata(context, selected) {
  if (selected.kind === 'pending') {
    const item = context.native().dcat?.corrections?.exchanges?.pending?.find(row => row.id === selected.id);
    need(item, 'The original pending request has completed or changed. Inspect its retained issue, proposal or decision.');
    return item;
  }
  return selected.kind === 'issue' ? context.model.dcatCorrectionExchange(selected.id) : context.model.dcatCorrectionProposal(selected.id);
}
function fileSelection(input) {
  need(['issue', 'recipient', 'initial-proposal', 'proposal', 'decision', 'file'].includes(input.kind), 'Choose an original exchange file kind.');
  need(input.kind === 'file' ? typeof input.key === 'string' && input.key.length <= 512 : input.key === undefined,
    'Use an exact issued file key only with kind file.');
  return { kind: input.kind, id: id(input.id), ...(input.key === undefined ? {} : { key: input.key }) };
}
async function descriptor(context, selected) {
  const file = await context.model.dcatCorrectionExchangeDownload(selected);
  need(plain(file) && file.id === selected.id && typeof file.file === 'string' && HASH.test(file.sha256 ?? '') &&
    Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= CORRECTION_PROPOSAL_MAX_BYTES,
    'The original exchange file descriptor changed.');
  return file;
}
function publicFile(file, selected) {
  return { ...selected, name: file.downloadName, mediaType: file.mediaType, sha256: file.sha256, bytes: file.bytes,
    read: { tool: PREFIX + 'file_read', ...selected, expectedSha256: file.sha256 } };
}
async function openOriginal(context, selected) {
  const file = await descriptor(context, selected), handle = await open(file.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({ bigint: true });
    need(info.isFile() && info.nlink === 1n && !(info.mode & 0o077n) && info.size === BigInt(file.bytes), 'The original private exchange file changed.');
    return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256, name: file.downloadName, type: file.mediaType };
  } catch (error) { await handle.close(); throw error; }
}
export function pageDcatCorrectionExchangeState(value) {
  if (value === undefined) return undefined;
  need(plain(value) && value.schema === 'stellar-forge.dcat-correction-exchanges.v1', 'Use the original exchange state.');
  return { schema: value.schema, issues: value.issues.length, proposals: value.proposals.length,
    decisions: value.decisions.length, pending: value.pending.length, inspectTool: PREFIX + 'list' };
}
export async function executeCkanDcatCorrectionExchange(context, name, input) {
  const { model, workspace } = context;
  if (name === PREFIX + 'list') {
    const request = { ...page(input), kind: input.kind ?? 'issues', query: text(input.query ?? '', 2000, 'a text filter', true),
      ...(input.correctionId === undefined ? {} : { correctionId: id(input.correctionId) }) };
    need(['issues', 'proposals', 'decisions'].includes(request.kind), 'Choose issues, proposals or decisions.');
    const value = await model.listDcatCorrectionExchanges(request);
    const summary = value.rows.map(row => ({ ...row,
      ...(row.editions ? { editions: undefined, editionCount: row.editions.length } : {}) }));
    const full = { tool: PREFIX + 'get', kind: request.kind === 'issues' ? 'issue' : 'proposal',
      qualification: 'Use the row UUID for issue/proposal metadata; decision files are available with kind decision.' };
    const pending = context.native().dcat?.corrections?.exchanges?.pending ?? [], po = number(input.pendingOffset, 0);
    return { workspace, kind: value.kind,
      ...rowsPage(summary, { offset: value.offset, limit: request.limit, total: value.total, nextOffset: value.nextOffset }, full, context.publicData),
      pending: rowsPage(pending.slice(po, po + request.limit),
        { offset: po, limit: request.limit, total: pending.length, nextOffset: po + request.limit < pending.length ? po + request.limit : null },
        row => completeFile(rawFile(row, 'dcat-correction-pending-' + row.id + '.json'), 'metadata_read', { kind: 'pending', id: row.id }), context.publicData) };
  }
  if (name === PREFIX + 'get' || name === PREFIX + 'metadata_read') {
    const selected = metadataSelection(input);
    if (name.endsWith('metadata_read')) {
      const chunk = await context.reads.read({ scope: context.scope, key: 'dcat-correction-exchange-metadata:' + selected.kind + ':' + selected.id,
        kind: 'ckan-dcat-correction-exchange-metadata', directory: context.directory, expectedSha256: hash(input.expectedSha256),
        readId: input.readId, offset: input.offset, limit: input.limit,
        load: async () => { const file = rawFile(await metadata(context, selected), 'dcat-correction-' + selected.kind + '-' + selected.id + '.json');
          return { name: file.name, type: file.mediaType, bytes: file.raw }; } });
      return { workspace, ...selected, ...chunk };
    }
    const value = await metadata(context, selected), file = rawFile(value, 'dcat-correction-' + selected.kind + '-' + selected.id + '.json');
    const full = completeFile(file, 'metadata_read', selected);
    const allowed = selected.kind === 'issue' ? ['history', 'files', 'proposals'] : selected.kind === 'proposal' ? ['editions', 'decisions'] : ['choices'];
    const section = input.section ?? allowed[0]; need(allowed.includes(section), 'Choose an original metadata section.');
    const request = page(input), rows = selected.kind === 'pending' ? value.request?.choices ?? [] : value[section] ?? [];
    const summary = { ...value };
    for (const key of allowed) delete summary[key];
    if (selected.kind === 'pending' && summary.request) {
      summary.request = { ...summary.request, choices: undefined };
      summary.choiceCount = value.request.choices?.length ?? 0;
    }
    if (summary.draft) summary.draft = { author: summary.draft.author, note: summary.draft.note,
      operationCount: summary.draft.operations.length, qualification: 'Working edits are retained in complete metadata; only a saved edition can be reconciled.' };
    return { workspace, kind: selected.kind, item: context.publicData(summary), section, completeFile: full,
      ...rowsPage(rows.slice(request.offset, request.offset + request.limit), { ...request, total: rows.length,
        nextOffset: request.offset + request.limit < rows.length ? request.offset + request.limit : null }, full, context.publicData) };
  }
  if (name === PREFIX + 'issue') {
    const value = { requestId: id(input.requestId), correctionId: id(input.correctionId), revisionId: id(input.revisionId),
      expectedDocumentSha256: hash(input.expectedDocumentSha256), issuer: text(input.issuer, 160, 'the issuer'),
      recipient: text(input.recipient, 160, 'the recipient'), label: text(input.label, 512, 'the package label'),
      note: text(input.note, 8192, 'the issue reason') };
    return context.launch(() => model.issueDcatCorrectionExchange(value));
  }
  if (name === PREFIX + 'receive') {
    const original = context.input(input.input);
    need(original.kind === 'dcat-correction-proposal', 'Use a host input of kind dcat-correction-proposal.');
    const expectedSha256 = hash(input.expectedSha256), checked = await context.privateFile(original.file, CORRECTION_PROPOSAL_MAX_BYTES);
    need(checked.sha256 === expectedSha256, 'The complete original return file changed.');
    const value = { requestId: id(input.requestId), file: original.file, expectedSha256 };
    return context.launch(() => model.receiveDcatCorrectionProposal(value));
  }
  if (name === PREFIX + 'preview' || name === PREFIX + 'preview_read') {
    const selected = { proposalId: id(input.proposalId), editionId: id(input.editionId),
      expectedRevisionId: id(input.expectedRevisionId), expectedDocumentSha256: hash(input.expectedDocumentSha256) };
    const reading = name.endsWith('preview_read');
    const requested = reading ? page({ offset: input.pageOffset, limit: input.pageLimit }) : page(input);
    const build = async () => model.previewDcatCorrectionProposal({ ...selected, ...requested, choices: await selectedChoices(context, input) });
    const readSelection = { proposalId: selected.proposalId, editionId: selected.editionId,
      expectedRevisionId: selected.expectedRevisionId, expectedDocumentSha256: selected.expectedDocumentSha256,
      pageOffset: requested.offset, pageLimit: requested.limit,
      ...(input.choicesInput === undefined ? {} : { choicesInput: input.choicesInput, expectedChoicesSha256: input.expectedChoicesSha256 }) };
    if (reading) {
      const chunk = await context.reads.read({ scope: context.scope,
        key: 'dcat-correction-reconciliation:' + selected.proposalId + ':' + selected.editionId + ':' + hash(input.expectedSha256),
        kind: 'ckan-dcat-correction-reconciliation', directory: context.directory, expectedSha256: input.expectedSha256,
        readId: input.readId, offset: input.offset, limit: input.limit,
        load: async () => { const file = rawFile(await build(), 'dcat-correction-reconciliation-page.json');
          return { name: file.name, type: file.mediaType, bytes: file.raw }; } });
      return { workspace, proposalId: selected.proposalId, editionId: selected.editionId, ...chunk };
    }
    const value = await build(), file = rawFile(value, 'dcat-correction-reconciliation-page.json');
    const full = completeFile(file, 'preview_read', readSelection), { rows, page: originalPage, choices: chosen, ...metadata } = value;
    return { workspace, ...context.publicData(metadata), choiceCount: chosen?.length ?? 0, completeFile: full,
      choicesSelection: input.choicesInput === undefined ? 'Repeat the same complete inline choices for preview_read.' : 'Original host alias and exact hash.',
      qualification: 'This complete file contains this exact original page. Follow nextOffset through every comparison page before adoption.',
      ...rowsPage(rows, originalPage, full, context.publicData) };
  }
  if (name === PREFIX + 'apply') {
    const value = { ...await selection(context, input), requestId: id(input.requestId),
      expectedPreviewSha256: hash(input.expectedPreviewSha256),
      author: text(input.author, 160, 'the adopting author'), note: text(input.note, 8192, 'the adoption reason') };
    need(value.author === value.author.trim() && value.note === value.note.trim(), 'Retain trimmed attribution exactly as inspected.');
    return context.launch(() => model.applyDcatCorrectionProposal(value));
  }
  if (name === PREFIX + 'files') {
    const selected = fileSelection(input), file = await descriptor(context, selected);
    return { workspace, file: publicFile(file, selected) };
  }
  if (name === PREFIX + 'file_read') {
    const selected = fileSelection(input);
    const chunk = await context.reads.read({ scope: context.scope,
      key: 'dcat-correction-exchange:' + selected.kind + ':' + selected.id + ':' + (selected.key ?? ''),
      kind: 'ckan-dcat-correction-exchange', directory: context.directory, expectedSha256: hash(input.expectedSha256),
      readId: input.readId, offset: input.offset, limit: input.limit, load: () => openOriginal(context, selected) });
    return { workspace, ...selected, ...chunk };
  }
  throw failure('TOOL_NOT_FOUND', 'Unknown catalogue correction exchange operation.');
}
