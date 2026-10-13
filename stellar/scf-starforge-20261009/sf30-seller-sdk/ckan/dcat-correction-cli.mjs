// MIT. Exact-text catalogue correction commands through the original workspace owner.
import { resolve } from 'node:path';
import { digest, fault } from '../postgres/publisher/files.mjs';
import { sourceBytes, exportRetained } from './dcat-semantic-files.mjs';

export const correctionCliOptions = {
  'correction-list': ['workspace', 'offset', 'limit', 'query'],
  'correction-get': ['workspace', 'correction'],
  'correction-inspect': ['workspace', 'correction', 'revision', 'pointer', 'offset', 'limit', 'query'],
  'correction-preview': ['workspace', 'correction', 'expected-revision', 'document-sha256', 'operations', 'operations-sha256'],
  'correction-create': ['workspace', 'request', 'kind', 'catalog', 'review', 'source-sha256', 'label', 'author', 'note'],
  'correction-save': ['workspace', 'request', 'correction', 'expected-revision', 'document-sha256',
    'operations', 'operations-sha256', 'result-sha256', 'author', 'note'],
  'correction-restore': ['workspace', 'request', 'correction', 'expected-revision', 'document-sha256', 'target-revision', 'author', 'note'],
  'correction-materialize': ['workspace', 'request', 'correction', 'revision', 'document-sha256', 'profile', 'label', 'author', 'note'],
  'correction-export': ['workspace', 'correction', 'revision', 'kind', 'out'],
};
export const correctionCliUsage = [
  '  dcat correction-list --workspace DIR [--offset 0 --limit 50 --query TEXT]',
  '  dcat correction-get --workspace DIR --correction ID',
  '  dcat correction-inspect --workspace DIR --correction ID [--revision ID --pointer /dataset/0 --offset 0 --limit 50 --query TEXT]',
  '  dcat correction-create --workspace DIR --request UUID --kind catalog|candidate --catalog ID|--review ID --source-sha256 HASH --label TEXT --author TEXT --note TEXT',
  '  dcat correction-preview --workspace DIR --correction ID --expected-revision ID --document-sha256 HASH --operations FILE.json --operations-sha256 HASH',
  '  dcat correction-save --workspace DIR --request UUID --correction ID --expected-revision ID --document-sha256 HASH --operations FILE.json --operations-sha256 HASH [--result-sha256 HASH] --author TEXT --note TEXT',
  '  dcat correction-restore --workspace DIR --request UUID --correction ID --expected-revision ID --document-sha256 HASH --target-revision ID --author TEXT --note TEXT',
  '  dcat correction-materialize --workspace DIR --request UUID --correction ID --revision ID --document-sha256 HASH --profile auto|1.1|3.0 --label TEXT --author TEXT --note TEXT',
  '  dcat correction-export --workspace DIR --correction ID --revision ID --kind document|revision --out FILE.json',
  'Keep the same --request UUID and complete arguments after an uncertain correction result. See CORRECTIONS_AGENT.md.',
];
function required(options, key) {
  if (typeof options[key] !== 'string' || !options[key]) throw fault('DCAT_COMMAND_ARGUMENTS', 'Supply --' + key + '.');
  return options[key];
}
function integer(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw fault('DCAT_COMMAND_ARGUMENTS', 'Use a nonnegative integer for --' + name + '.');
  return Number(value);
}
function page(options) {
  return { offset: integer(options.offset, 'offset', 0), limit: integer(options.limit, 'limit', 50),
    query: options.query ?? '' };
}
function guard(options) {
  return { correctionId: required(options, 'correction'), expectedRevisionId: required(options, 'expected-revision'),
    expectedDocumentSha256: required(options, 'document-sha256') };
}
function attribution(options) {
  return { requestId: required(options, 'request'), author: required(options, 'author'), note: required(options, 'note') };
}
async function operations(options) {
  const raw = await sourceBytes(resolve(required(options, 'operations')), 33554432);
  const expected = required(options, 'operations-sha256');
  if (!/^[a-f0-9]{64}$/.test(expected) || digest(raw) !== expected)
    throw fault('DCAT_CORRECTION_OPERATIONS_CHANGED', 'Use the complete inspected operations file SHA-256.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('DCAT_CORRECTION_OPERATIONS_INVALID', 'Use one complete UTF-8 JSON array of ordered edits.'); }
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000)
    throw fault('DCAT_CORRECTION_OPERATIONS_INVALID', 'Supply between one and 1,000 ordered edits.');
  // Numeric and structured catalogue values stay inside literal valueText strings.
  return value;
}
export async function executeDcatCorrectionCommand(project, command, options) {
  if (command === 'correction-list') return project.listDcatCorrections(page(options));
  if (command === 'correction-get') return project.dcatCorrection(required(options, 'correction'));
  if (command === 'correction-inspect') return project.inspectDcatCorrection({
    correctionId: required(options, 'correction'), ...(options.revision ? { revisionId: options.revision } : {}),
    pointer: options.pointer ?? '', ...page(options) });
  if (command === 'correction-preview') return project.previewDcatCorrection({
    ...guard(options), operations: await operations(options) });
  if (command === 'correction-create') {
    const kind = required(options, 'kind');
    if (!['catalog', 'candidate'].includes(kind) || kind === 'catalog' && (!options.catalog || options.review !== undefined) ||
        kind === 'candidate' && (!options.review || options.catalog !== undefined))
      throw fault('DCAT_COMMAND_ARGUMENTS', 'Choose catalog with --catalog, or candidate with --review.');
    return project.createDcatCorrection({ ...attribution(options), kind,
      ...(kind === 'catalog' ? { catalogId: options.catalog } : { reviewId: options.review }),
      expectedSha256: required(options, 'source-sha256'), label: required(options, 'label') });
  }
  if (command === 'correction-save') return project.saveDcatCorrection({
    ...guard(options), ...attribution(options), operations: await operations(options),
    ...(options['result-sha256'] !== undefined ? { expectedResultSha256: required(options, 'result-sha256') } : {}) });
  if (command === 'correction-restore') return project.restoreDcatCorrection({
    ...guard(options), ...attribution(options), targetRevisionId: required(options, 'target-revision') });
  if (command === 'correction-materialize') return project.materializeDcatCorrection({
    ...attribution(options), correctionId: required(options, 'correction'), revisionId: required(options, 'revision'),
    expectedDocumentSha256: required(options, 'document-sha256'), profile: required(options, 'profile'),
    label: required(options, 'label') });
  if (command === 'correction-export') {
    const selected = await project.dcatCorrectionDownload({ correctionId: required(options, 'correction'),
      revisionId: required(options, 'revision'), kind: required(options, 'kind') });
    const out = resolve(required(options, 'out')); await exportRetained(selected, out);
    return { correctionId: selected.correctionId, revisionId: selected.id, kind: options.kind,
      out, bytes: selected.bytes, sha256: selected.sha256 };
  }
  throw fault('DCAT_COMMAND_UNKNOWN', 'Choose an installed catalogue correction command.');
}
