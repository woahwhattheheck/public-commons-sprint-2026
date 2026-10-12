// MIT. Complete saved-publisher delivery identities shared by merchant and receiver.
import { createHash } from 'node:crypto';

export const PUBLISHER_CONNECTION_SCHEMA = 'stellar-forge.360giving-merchant-connection.v1';
export const PUBLISHER_MANIFEST_SCHEMA = 'stellar-forge.360giving-merchant-export.v1';
export const PUBLISHER_MANIFEST_NAME = '360giving-manifest.json';
export const PUBLISHER_MAX_FILE = 1024 * 1024 * 1024;
export const PUBLISHER_MAX_MANIFEST = 4 * 1024 * 1024;
export const PUBLISHER_SHA = /^[a-f0-9]{64}$/;
export const PUBLISHER_ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const PUBLISHER_KEY = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const PUBLISHER_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const failure = (code, message) => Object.assign(new Error(message), { code: 'PUBLISHER360_' + code });
export function check(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw failure('INVALID_PARAMS', 'Select a valid ' + label + '.');
  return value;
}
export function exact(value, keys, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw failure('INVALID_PARAMS', 'Supply the declared fields and every required field.');
  return value;
}
export function counter(value, label = 'Counter', maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw failure('INVALID_PARAMS', label + ' exceeds its original range.');
  return value;
}
export function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export const encode = value => Buffer.from(JSON.stringify(ordered(value), null, 2) + '\n');
export function sourceSelection(kind, input) {
  if (kind === 'handoff') {
    exact(input, ['requestId','edition','decision','candidate'], ['requestId','edition']);
    const result = { requestId: check(input.requestId, PUBLISHER_KEY, 'original request ID'),
      edition: check(input.edition, PUBLISHER_SHA, 'source edition'),
      decision: input.decision == null ? null : check(input.decision, PUBLISHER_SHA, 'named decision'),
      candidate: input.candidate == null ? null : check(input.candidate, PUBLISHER_SHA, 'candidate') };
    if (result.candidate && !result.decision) throw failure('INVALID_PARAMS', 'Select the original decision with its candidate.');
    return result;
  }
  if (kind === 'changes') {
    exact(input, ['dataset','comparison'], ['dataset','comparison']);
    return { dataset: check(input.dataset, PUBLISHER_KEY, 'native dataset'),
      comparison: check(input.comparison, PUBLISHER_SHA, 'native comparison') };
  }
  throw failure('INVALID_PARAMS', 'Choose a complete publisher handoff or comparison file.');
}
export function publisherExportId(workspace, kind, selection) {
  exact(workspace, ['alias','id'], ['alias','id']);
  check(workspace.alias, PUBLISHER_ALIAS, 'workspace alias'); check(workspace.id, PUBLISHER_UUID, 'publisher workspace UUID');
  return digest(encode({ schema: PUBLISHER_MANIFEST_SCHEMA, workspace, kind, selection: sourceSelection(kind, selection) }));
}
/** Preserve an existing request's exact input while matching only native optional defaults. */
export function originalPublisherInput(original, action, input) {
  if (!plain(original) || original.schema !== 'stellar-forge.360giving-operator.v1.request' ||
      original.action !== action || !plain(original.input) || !plain(input)) return input;
  const selection = value => {
    const result = { ...value };
    if (action === 'intake' && !Object.hasOwn(result, 'label')) result.label = result.dataset;
    const optional = { intake: ['capture','transport'], build: ['candidate'], export: ['decision','candidate'] }[action] ?? [];
    for (const field of optional) if (result[field] === null) delete result[field];
    return JSON.stringify(ordered(result));
  };
  return selection(original.input) === selection(input) ? original.input : input;
}
export function publisherManifest(value) {
  exact(value, ['schema','exportId','workspace','kind','selection','original','files'],
    ['schema','exportId','workspace','kind','selection','original','files']);
  if (value.schema !== PUBLISHER_MANIFEST_SCHEMA || !plain(value.original) || !Array.isArray(value.files) || value.files.length !== 1)
    throw failure('MANIFEST_INVALID', 'Select the complete original publisher delivery manifest.');
  const selection = sourceSelection(value.kind, value.selection);
  const exportId = publisherExportId(value.workspace, value.kind, selection);
  if (value.exportId !== exportId) throw failure('MANIFEST_CHANGED', 'The original publisher and delivery selection differ.');
  const file = value.files[0], handoff = value.kind === 'handoff';
  exact(file, ['name','bytes','sha256','contentType'], ['name','bytes','sha256','contentType']);
  if (file.name !== (handoff ? '360giving-complete-handoff.zip' : '360giving-complete-changes.jsonl') ||
      file.contentType !== (handoff ? 'application/zip' : 'application/x-ndjson') ||
      typeof file.bytes !== 'number' || counter(file.bytes, 'Complete file bytes', PUBLISHER_MAX_FILE) < (handoff ? 1 : 0))
    throw failure('MANIFEST_INVALID', 'Retain the original complete filename, media type and byte count.');
  check(file.sha256, PUBLISHER_SHA, 'complete file SHA256');
  if (handoff) {
    const original = value.original;
    if (original.schema !== 'stellar-forge.360giving-operator.v1.request' || original.id !== selection.requestId ||
        original.workspaceId !== value.workspace.id || original.action !== 'export' ||
        original.status !== 'complete' || original.input?.edition !== selection.edition ||
        (original.input.decision ?? null) !== selection.decision || (original.input.candidate ?? null) !== selection.candidate ||
        original.result?.file !== selection.requestId || original.result?.sha256 !== file.sha256 ||
        counter(original.result?.bytes, 'Native archive bytes', PUBLISHER_MAX_FILE) !== file.bytes ||
        original.result?.manifest?.schema !== 'stellar-forge.360giving-operator.v1.handoff' ||
        original.result?.manifest?.workspaceId !== value.workspace.id || original.result?.manifest?.request !== selection.requestId)
      throw failure('MANIFEST_CHANGED', 'The full native export request differs from its complete delivery.');
  } else if (value.original.id !== selection.comparison || value.original.changesSha256 !== file.sha256) {
    throw failure('MANIFEST_CHANGED', 'The full original comparison differs from its complete changes file.');
  }
  return { schema: PUBLISHER_MANIFEST_SCHEMA, exportId, workspace: { ...value.workspace },
    kind: value.kind, selection, original: value.original, files: [{ ...file }] };
}
export function parsePublisherManifest(bytes, exportId) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > PUBLISHER_MAX_MANIFEST)
    throw failure('MANIFEST_INVALID', 'Select one complete publisher manifest within its original limit.');
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('MANIFEST_INVALID', 'The publisher manifest is not complete UTF-8 JSON.'); }
  const value = publisherManifest(raw);
  if (value.exportId !== exportId || !encode(value).equals(bytes))
    throw failure('MANIFEST_CHANGED', 'The complete manifest differs from its canonical original bytes.');
  return value;
}
