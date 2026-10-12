// MIT. Buyer-issued sources through the original accounting-platform client.
import { createHash } from 'node:crypto';
import { buyerAccountingDefinitions } from './catalog/accounting-buyer.mjs';

const PREFIX = 'merchant_accounting_buyer_';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const LIMIT = 64 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code: 'ACCOUNTING_PLATFORM_CLIENT_' + code });
function need(ok, message, code = 'BINDING') { if (!ok) throw fail(code, message); }
function exact(value, fields) {
  need(plain(value) && Object.keys(value).every(key => fields.includes(key)), 'Keep only this original buyer operation’s declared fields.', 'ARGUMENTS');
}
function text(value, maximum, title) {
  need(typeof value === 'string' && value.length <= maximum && value.trim().length > 0, 'Supply the original ' + title + '.', 'ARGUMENTS');
  return value.trim();
}
const nativeHash = value => createHash('sha256').update(JSON.stringify(value, null, 2) + '\n').digest('hex');
const copy = value => structuredClone(value);
export const buyerAccountingClientSpec = Object.fromEntries(buyerAccountingDefinitions.map(([name, , fields, required, annotations]) =>
  [name.slice(PREFIX.length).replaceAll('_', '-'), { fields, required, readOnly: annotations.readOnly === true }]));

/** This is the existing AccountantWorkspace.create request identity, not a journal. */
function handoffRequest(args) {
  return { runId: null, closeId: null, name: text(args.name, 160, 'handoff name'), actor: text(args.actor, 240, 'operator'),
    labels: [], buyerStartup: { sha256: args.sourceSha256 } };
}
function checkedBinding(value) {
  need(plain(value) && value.sourceMode === 'buyer' && SHA.test(value.workspaceId ?? '') &&
    SHA.test(value.sourcesSha256 ?? '') && SHA.test(value.sourceSha256 ?? '') &&
    Number.isSafeInteger(value.sourceBytes) && value.sourceBytes > 0 && value.sourceBytes <= LIMIT,
    'The native reply does not retain its original buyer workspace and source binding.', 'REPLY');
  return value;
}
function checkedStartup(value) {
  need(plain(value) && value.schema === 'stellar-forge.buyer-accounting-operation.v1' &&
    value.sourceMode === 'buyer' && Number.isSafeInteger(value.workspaceRevision) && value.workspaceRevision >= 1,
    'Read the original buyer startup from this configured workspace.', 'REPLY');
  const binding = checkedBinding(value.binding), source = value.source;
  need(plain(source) && source.schema === 'stellar-forge.buyer-accounting-startup.v1' &&
    UUID.test(source.handoffId ?? '') && source.sha256 === binding.sourceSha256 && source.bytes === binding.sourceBytes &&
    typeof source.name === 'string' && typeof source.actor === 'string' && Array.isArray(source.handoffs) &&
    source.handoffs.every(row => plain(row) && UUID.test(row.id ?? '')),
    'The original startup, source and retained first-handoff identity disagree.', 'REPLY');
  return value;
}
function checkedSource(value, expectedSha256) {
  need(plain(value) && value.sourceKind === 'buyer-expense-period' && SHA.test(value.sourceSha256 ?? '') &&
    (expectedSha256 === undefined || value.sourceSha256 === expectedSha256) &&
    value.source?.kind === 'buyer-expense-period' && value.source.reportSha256 === value.sourceSha256 &&
    Number.isSafeInteger(value.source.reportBytes) && value.source.reportBytes > 0 && value.source.reportBytes <= LIMIT &&
    plain(value.counts) && ['allocationRows', 'expenseRows', 'creditRows', 'outstandingReservations', 'sourceCaptures']
      .every(key => Number.isSafeInteger(value.counts[key]) && value.counts[key] >= 0) &&
    value.counts.expenseRows + value.counts.creditRows === value.counts.allocationRows,
    'The original buyer source review has inconsistent source or row-count identity.', 'REPLY');
  return value;
}
function sameWorkspace(actual, expected) {
  const binding = checkedBinding(actual);
  need(binding.workspaceId === expected.workspaceId && binding.sourcesSha256 === expected.sourcesSha256 &&
    binding.sourceSha256 === expected.sourceSha256 && binding.sourceBytes === expected.sourceBytes,
    'The configured alias now identifies another original buyer workspace or source.', 'NATIVE_BINDING');
}
function selectedHandoff(startup, id) {
  const rows = startup.source.handoffs.filter(row => row.id === id);
  need(rows.length <= 1, 'The native startup repeats the selected handoff identity.', 'REPLY');
  return rows[0] ?? null;
}
function compactStartup(value) {
  const { handoffs, ...source } = value.source;
  return { schema: value.schema, sourceMode: value.sourceMode, binding: copy(value.binding),
    workspaceRevision: value.workspaceRevision, source: copy(source), retainedHandoffs: handoffs.length,
    firstHandoff: copy(selectedHandoff(value, source.handoffId)) };
}

/** Validate the exact small native mutation and reviewed identity. */
export function buyerAccountingClientOperation(value, wireArguments) {
  const action = value.command.tool.slice(PREFIX.length).replaceAll('_', '-');
  need(value.command.tool === PREFIX + action, 'Keep the exact original buyer command name.', 'PREVIEW');
  need(['initialize', 'handoff'].includes(action), 'Choose initialization or the original first handoff.', 'PREVIEW');
  const args = wireArguments('buyer', action, value.command.arguments), binding = copy(value.binding);
  const fields = action === 'initialize' ? ['sourceSha256', 'sourceBytes', 'name', 'actor'] :
    ['workspaceId', 'sourcesSha256', 'sourceSha256', 'sourceBytes', 'handoffId', 'name', 'actor', 'requestSha256'];
  need(plain(binding) && Object.keys(binding).length === fields.length && fields.every(key => Object.hasOwn(binding, key)),
    'Keep every original buyer operation binding without additional fields.', 'PREVIEW');
  need(SHA.test(binding.sourceSha256 ?? '') && Number.isSafeInteger(binding.sourceBytes) &&
    binding.sourceBytes > 0 && binding.sourceBytes <= LIMIT &&
    binding.sourceSha256 === args.sourceSha256 && binding.name === text(args.name, 160, 'name') &&
    binding.actor === text(args.actor, 240, 'operator'), 'The buyer command differs from its original source or named review.', 'BINDING');
  if (action === 'initialize') {
    need(!/[\u0000-\u001f\u007f]/.test(args.name + args.actor), 'Use the original supported initialization name and operator.', 'ARGUMENTS');
  } else {
    need(SHA.test(binding.workspaceId ?? '') && SHA.test(binding.sourcesSha256 ?? '') &&
      UUID.test(binding.handoffId ?? '') && binding.handoffId === args.handoffId &&
      binding.requestSha256 === nativeHash(handoffRequest(args)),
      'Keep the original workspace, first-handoff UUID and exact native create request.', 'BINDING');
  }
  return { platform: 'buyer', action, command: { tool: PREFIX + action, arguments: args }, binding };
}

/** Read native source/startup only; explicit command execution stays in the caller. */
export async function previewBuyerAccountingClient(action, value, { workspace, read, wireArguments, options } = {}) {
  exact(value, action === 'initialize' ? ['workspace', 'source', 'sourceSha256', 'name', 'actor'] :
    ['workspace', 'handoffId', 'sourceSha256', 'name', 'actor', 'revision']);
  need(value.workspace === undefined || value.workspace === workspace, 'Keep this configured workspace alias.', 'CONNECTION_BINDING');
  if (action === 'initialize') {
    // Validate caller text and aliases before reading its declared source.
    wireArguments('buyer', action, { ...value, workspace, sourceSha256: value.sourceSha256 ?? '0'.repeat(64) });
    const review = checkedSource(await read('source-preview', { source: value.source,
      ...(value.sourceSha256 === undefined ? {} : { sourceSha256: value.sourceSha256 }) }, options), value.sourceSha256);
    need(review.input?.source === value.source && review.input.sha256 === review.sourceSha256 &&
      review.input.bytes === review.source.reportBytes, 'The host preview returned another original input.', 'REPLY');
    const args = { ...value, workspace, sourceSha256: review.sourceSha256 };
    return { ...buyerAccountingClientOperation({ command: { tool: PREFIX + action, arguments: args },
      binding: { sourceSha256: review.sourceSha256, sourceBytes: review.input.bytes,
        name: text(value.name, 160, 'name'), actor: text(value.actor, 240, 'operator') } }, wireArguments),
      reviewOrigin: 'CLIENT_REVIEW_OF_ORIGINAL_NATIVE_RECORD', observed: review };
  }
  need(action === 'handoff', 'Choose initialization or the original first handoff.', 'ARGUMENTS');
  text(value.name, 160, 'handoff name'); text(value.actor, 240, 'operator');
  const startup = checkedStartup(await read('startup', {}, options));
  const review = checkedSource(await read('prepare', { sourceSha256: startup.source.sha256 }, options), startup.source.sha256);
  sameWorkspace(review.binding, startup.binding);
  need(review.handoffId === startup.source.handoffId && review.source.reportBytes === startup.source.bytes &&
    Number.isSafeInteger(review.workspaceRevision) &&
    review.workspaceRevision >= 1, 'The retained first-handoff review is inconsistent.', 'REPLY');
  const args = { workspace, handoffId: startup.source.handoffId, sourceSha256: review.sourceSha256,
    name: value.name, actor: value.actor, revision: review.workspaceRevision };
  for (const field of ['handoffId', 'sourceSha256', 'revision'])
    need(value[field] === undefined || value[field] === args[field], 'The caller’s original ' + field + ' differs from the current native review.', 'BINDING');
  const binding = { workspaceId: startup.binding.workspaceId, sourcesSha256: startup.binding.sourcesSha256,
    sourceSha256: review.sourceSha256, sourceBytes: review.source.reportBytes, handoffId: args.handoffId,
    name: text(args.name, 160, 'name'), actor: text(args.actor, 240, 'operator'), requestSha256: nativeHash(handoffRequest(args)) };
  return { ...buyerAccountingClientOperation({ command: { tool: PREFIX + action, arguments: args }, binding }, wireArguments),
    reviewOrigin: 'CLIENT_REVIEW_OF_ORIGINAL_NATIVE_RECORD', observed: { startup: compactStartup(startup), review } };
}

/** An absent initialized directory is distinct from another accepted initialization. */
export async function observeBuyerAccountingClient(operation, { read, options } = {}) {
  const { action, binding: expected } = operation;
  let startup;
  try { startup = checkedStartup(await read('startup', {}, options)); }
  catch (error) {
    if (action === 'initialize' && error.code === 'ACCOUNTING_BUYER_INITIALIZATION_REQUIRED')
      return { found: false, platform: 'buyer', action, binding: copy(expected), pending: false };
    throw error;
  }
  need(startup.source.sha256 === expected.sourceSha256 && startup.source.bytes === expected.sourceBytes,
    'This workspace retains a different original buyer source.', 'NATIVE_BINDING');
  if (action === 'initialize') {
    need(startup.source.name === expected.name && startup.source.actor === expected.actor,
      'This source was initialized under another original name or operator.', 'NATIVE_BINDING');
    return { ...compactStartup(startup), found: true, platform: 'buyer', action, binding: copy(expected), pending: false,
      nativeBinding: copy(startup.binding), recoveredIdentity: { handoffId: startup.source.handoffId, sourceSha256: startup.source.sha256 } };
  }
  sameWorkspace(startup.binding, { ...expected, sourceMode: 'buyer' });
  need(startup.source.handoffId === expected.handoffId, 'This workspace retains another first-handoff UUID.', 'NATIVE_BINDING');
  const record = selectedHandoff(startup, expected.handoffId);
  if (!record) return { found: false, platform: 'buyer', action, binding: copy(expected), pending: false,
    workspaceRevision: startup.workspaceRevision, nativeBinding: copy(startup.binding) };
  need(SHA.test(record.requestSha256 ?? '') && record.requestSha256 === expected.requestSha256 &&
    record.sourceSha256 === expected.sourceSha256 && record.name === expected.name && record.actor === expected.actor,
    'The retained handoff UUID belongs to another named source request. Reopen its actual original record.', 'NATIVE_BINDING');
  return { found: true, platform: 'buyer', action, binding: copy(expected), pending: false,
    workspaceRevision: startup.workspaceRevision, nativeBinding: copy(startup.binding), record: copy(record),
    sourceSha256: startup.source.sha256, sourceBytes: startup.source.bytes };
}

/** Traverse every original source page with one retained source digest and count. */
export async function* buyerAccountingSourcePages(value, { read, options } = {}) {
  exact(value, ['source', 'sourceSha256', 'view', 'limit']);
  need(['allocations', 'outstanding', 'captures'].includes(value.view), 'Choose allocations, outstanding or captures.', 'ARGUMENTS');
  const limit = value.limit ?? 200;
  need(Number.isSafeInteger(limit) && limit >= 1 && limit <= 200, 'Use 1 to 200 original rows per page.', 'ARGUMENTS');
  const action = value.source === undefined ? 'prepare' : 'source-preview';
  need(action !== 'prepare' || SHA.test(value.sourceSha256 ?? ''), 'Keep the retained original source SHA256.', 'ARGUMENTS');
  let offset = 0, expectedSha256 = value.sourceSha256, expectedBytes, total;
  for (;;) {
    const result = checkedSource(await read(action, { ...(value.source === undefined ? {} : { source: value.source }),
      ...(expectedSha256 === undefined ? {} : { sourceSha256: expectedSha256 }), view: value.view, offset, limit }, options), expectedSha256);
    const page = result.page;
    need(plain(page) && page.view === value.view && page.offset === offset && page.limit === limit &&
      Number.isSafeInteger(page.total) && page.total >= 0 && Array.isArray(page.items) && page.items.length <= limit,
      'The original source page does not retain its complete offset/count identity.', 'REPLY');
    expectedSha256 ??= result.sourceSha256; expectedBytes ??= result.source.reportBytes; total ??= page.total;
    const count = result.counts[{ allocations: 'allocationRows', outstanding: 'outstandingReservations', captures: 'sourceCaptures' }[value.view]];
    need(result.source.reportBytes === expectedBytes && page.total === total && total === count &&
      offset + page.items.length <= total, 'The original source edition or complete row count changed between pages.', 'OBSERVATION_CHANGED');
    yield result;
    offset += page.items.length;
    if (offset === total) return;
    need(page.items.length > 0, 'The original source page did not advance.', 'REPLY');
  }
}
